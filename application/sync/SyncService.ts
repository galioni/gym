import {
  SyncSettings,
  SyncSettingsRepository,
} from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import {
  ConflictResolution,
  PlansSnapshot,
  SettingsSnapshot,
  SyncConflict,
  SyncRestorePoint,
  SyncEntity,
  SyncNowResult,
  TemplateSnapshot,
  WorkoutDataSnapshot,
} from "./syncTypes";
import { DayData } from "../../types";
import { stableSerialize } from "./contentHash";
import { CloudLimitError } from "./syncErrors";
import { SyncAllowance, SyncAllowanceError } from "./syncAllowance";
import { HistoryLimitedCloudWorkout, historyCutoff } from "./historyWindow";
import { reconcileDeletions } from "./deletionReconciliation";
import {
  agreedBase,
  baseAfterPartialWrite,
  collectionHashes,
  baseDaysFrom,
  Collection,
  EMPTY_SYNC_BASE,
  mergeCollection,
  mergeWorkoutDays,
  SyncBase,
} from "./syncMerge";
import {
  collectionToPlans,
  collectionToSettings,
  collectionToTemplates,
  plansToCollection,
  settingsToCollection,
  templatesToCollection,
} from "./collections";
import { AccountSettingsRepository } from "../../interfaces/workout/AccountSettingsRepository";

type ConflictResolutionMap = Partial<Record<SyncEntity, ConflictResolution>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkoutDataSnapshot(value: unknown): value is WorkoutDataSnapshot {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    typeof value["updatedAt"] === "string" &&
    isRecord(value["data"])
  );
}

function isTemplateSnapshot(value: unknown): value is TemplateSnapshot {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    typeof value["updatedAt"] === "string" &&
    isRecord(value["data"])
  );
}

function isPlansSnapshot(value: unknown): value is PlansSnapshot {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    typeof value["updatedAt"] === "string" &&
    Array.isArray(value["data"])
  );
}

interface SyncServiceDeps {
  settingsRepository: SyncSettingsRepository;
  /** Asked at the start of every sync; a Free account that has used its monthly sync is refused here. */
  allowance?: Pick<SyncAllowance, "begin">;
  /**
   * Asked before every sync, automatic or manual. Local data is not stored per account, so a browser that held another
   * account's data would otherwise upload it to whoever signed in next. "otherAccount" refuses the sync before anything is read.
   */
  ownership?: { check(): Promise<"ok" | "otherAccount"> };
  localWorkoutRepository: WorkoutDataRepository;
  localTemplateRepository: TemplateRepository;
  cloudWorkoutRepository: WorkoutDataRepository | null;
  cloudTemplateRepository: TemplateRepository | null;
  localPlansRepository?: PlansRepository | null;
  cloudPlansRepository?: PlansRepository | null;
  localSettingsRepository?: AccountSettingsRepository | null;
  cloudSettingsRepository?: AccountSettingsRepository | null;
}

function collectDiffPaths(
  localValue: unknown,
  cloudValue: unknown,
  path = "",
  limit = 50
): string[] {
  if (limit <= 0) {
    return [];
  }

  const localIsObject = localValue !== null && typeof localValue === "object";
  const cloudIsObject = cloudValue !== null && typeof cloudValue === "object";

  if (!localIsObject || !cloudIsObject) {
    return stableSerialize(localValue) === stableSerialize(cloudValue)
      ? []
      : [path || "(root)"];
  }

  const localArray = Array.isArray(localValue);
  const cloudArray = Array.isArray(cloudValue);
  if (localArray !== cloudArray) {
    return [path || "(root)"];
  }

  const keys = new Set<string>();
  if (Array.isArray(localValue) && Array.isArray(cloudValue)) {
    const maxLength = Math.max(localValue.length, cloudValue.length);
    for (let i = 0; i < maxLength; i += 1) {
      keys.add(String(i));
    }
  } else {
    Object.keys(localValue as Record<string, unknown>).forEach((k) => keys.add(k));
    Object.keys(cloudValue as Record<string, unknown>).forEach((k) => keys.add(k));
  }

  const diffs: string[] = [];
  for (const key of keys) {
    if (diffs.length >= limit) {
      break;
    }
    const nextPath = path ? `${path}.${key}` : key;
    const localChild = (localValue as Record<string, unknown>)[key];
    const cloudChild = (cloudValue as Record<string, unknown>)[key];
    diffs.push(...collectDiffPaths(localChild, cloudChild, nextPath, limit - diffs.length));
  }
  return diffs;
}

function isSettingsSnapshot(value: unknown): value is SettingsSnapshot {
  return (
    isRecord(value) &&
    typeof value["version"] === "number" &&
    typeof value["updatedAt"] === "string" &&
    isRecord(value["data"])
  );
}

type Snap = { version: number; updatedAt: string; data: unknown };

/**
 * One keyed collection synced item by item (templates, plans, account settings). The adapters keep the merge
 * and the write path generic; each entity only says how to read, write, validate and describe its items.
 */
interface CollectionSync {
  entity: SyncEntity;
  baseKey: "templates" | "plans" | "settings";
  /** Preferences nobody should be asked about: on a both-changed item this device simply wins. */
  quiet: boolean;
  local: Snap | null;
  cloud: Snap | null;
  readLocal(): Promise<Snap | null>;
  readCloud(): Promise<Snap | null>;
  writeLocal(next: Snap): Promise<void>;
  writeCloud(next: Snap): Promise<void>;
  isValid(snapshot: unknown): boolean;
  toCollection(data: unknown): Collection<unknown>;
  fromCollection(collection: Collection<unknown>): unknown;
  describeConflicts(keys: string[], local: Collection<unknown>, cloud: Collection<unknown>): string[];
}

interface SyncRun {
  /** Local snapshots as read at the start of the run; local writes are skipped if local changed since. */
  expected: {
    workout: WorkoutDataSnapshot | null;
    templates: TemplateSnapshot | null;
    plans: PlansSnapshot | null;
    settings: SettingsSnapshot | null;
  };
  /** A local write changed data, so in-memory state is stale. */
  applied: boolean;
}

function tombstonesOf(snapshot: unknown): unknown {
  return snapshot && typeof snapshot === "object" && "deletedDays" in snapshot
    ? (snapshot as { deletedDays?: unknown }).deletedDays ?? {}
    : {};
}

export class SyncService {
  private inFlight: Promise<SyncNowResult> | null = null;
  /**
   * This run only brings the cloud's data to this device; nothing is sent. Every cloud write is held back and handled like a
   * refusal (what arrived is kept, what both sides agree on is recorded), so local data and pending deletions are untouched.
   */
  private uploadsHeld = false;
  /** For a plan that keeps a limited history in the cloud: the cloud with older days filtered out of every upload. */
  private limitedCloud: WorkoutDataRepository | null = null;
  private run: SyncRun = { expected: { workout: null, templates: null, plans: null, settings: null }, applied: false };

  public constructor(private readonly deps: SyncServiceDeps) {}

  public async getSettings(): Promise<SyncSettings> {
    return this.deps.settingsRepository.readSettings();
  }

  public async getRestorePoints(): Promise<SyncRestorePoint[]> {
    const raw = await this.deps.settingsRepository.readRestorePoints();
    return raw as SyncRestorePoint[];
  }

  public async pruneRestorePoints(): Promise<void> {
    const points = await this.getRestorePoints();
    if (points.length <= 1) {
      return;
    }
    const newest = points.reduce((latest, point) =>
      point.createdAt > latest.createdAt ? point : latest
    );
    await this.deps.settingsRepository.writeRestorePoints([
      newest as {
        id: string;
        createdAt: string;
        workoutData: unknown;
        templates: unknown;
      },
    ]);
  }

  public async rollbackToRestorePoint(id: string): Promise<SyncNowResult> {
    const points = await this.getRestorePoints();
    const target = points.find((point) => point.id === id) as SyncRestorePoint | undefined;
    if (!target) {
      return { status: "error", conflicts: [], message: "Restore point not found." };
    }

    if (target.workoutData) {
      if (!isWorkoutDataSnapshot(target.workoutData)) {
        return { status: "error", conflicts: [], message: "Restore point workout data is corrupted." };
      }
      await this.deps.localWorkoutRepository.writeSnapshot(target.workoutData);
    }
    if (target.templates) {
      if (!isTemplateSnapshot(target.templates)) {
        return { status: "error", conflicts: [], message: "Restore point template data is corrupted." };
      }
      await this.deps.localTemplateRepository.writeSnapshot(target.templates);
    }
    if (target.plans && this.deps.localPlansRepository) {
      if (!isPlansSnapshot(target.plans)) {
        return { status: "error", conflicts: [], message: "Restore point plans data is corrupted." };
      }
      await this.deps.localPlansRepository.writeSnapshot(target.plans);
    }

    return { status: "success", conflicts: [], message: "Rollback completed from restore point." };
  }

  /**
   * Runs one sync. Calls are single-flight: an automatic sync and a manual one never overlap. A call
   * without a conflict resolution joins the running sync; one with a resolution waits for it, then runs.
   */
  public async syncNow(
    resolution: ConflictResolutionMap = {},
    options: { automatic?: boolean; downloadOnly?: boolean } = {}
  ): Promise<SyncNowResult> {
    if (this.deps.ownership && (await this.deps.ownership.check()) === "otherAccount") {
      return {
        status: "error",
        conflicts: [],
        reason: "otherAccount",
        message: "This browser holds another account's data, so nothing was synced. Choose \"Switch to this account\" or sign out.",
      };
    }
    if (this.inFlight) {
      if (Object.keys(resolution).length === 0) {
        return this.inFlight;
      }
      await this.inFlight.catch(() => undefined);
    }
    const running = this.runSync(resolution, options.automatic === true, options.downloadOnly === true);
    this.inFlight = running;
    try {
      return await running;
    } finally {
      if (this.inFlight === running) {
        this.inFlight = null;
      }
    }
  }

  /**
   * Writes to local storage only if local storage still holds what this run read. If the user edited in
   * the meantime the write is skipped (their edit is newer than our merge) and the next sync picks it up.
   */
  private async writeLocal<T extends { data: unknown }>(
    repository: { readSnapshot(): Promise<T | null>; writeSnapshot(snapshot: T): Promise<void> },
    expected: T | null,
    next: T
  ): Promise<void> {
    const current = await repository.readSnapshot();
    if (
      stableSerialize(current?.data ?? null) !== stableSerialize(expected?.data ?? null) ||
      stableSerialize(tombstonesOf(current)) !== stableSerialize(tombstonesOf(expected))
    ) {
      return;
    }
    await repository.writeSnapshot(next);
    if (stableSerialize(next.data) !== stableSerialize(expected?.data ?? null)) {
      this.run.applied = true;
    }
  }

  private async runSync(
    resolution: ConflictResolutionMap,
    automatic: boolean,
    downloadOnly = false
  ): Promise<SyncNowResult> {
    this.uploadsHeld = downloadOnly;
    const settings = await this.getSettings();

    if (!this.deps.cloudWorkoutRepository || !this.deps.cloudTemplateRepository) {
      const message =
        "Cloud sync mode is selected, but cloud repositories are unavailable. Check sync env vars.";
      await this.deps.settingsRepository.writeSettings({
        ...settings,
        lastError: message,
      });
      return { status: "error", conflicts: [], message };
    }

    try {
      // Permission first, before any read: a sync is both directions, so a refusal means nothing is read or written.
      this.run = { expected: { workout: null, templates: null, plans: null, settings: null }, applied: false };
      this.limitedCloud = null;
      const grant = await this.deps.allowance?.begin();
      if (grant?.historyDays && this.deps.cloudWorkoutRepository) {
        this.limitedCloud = new HistoryLimitedCloudWorkout(this.deps.cloudWorkoutRepository, historyCutoff(grant.historyDays));
      }

      const base: SyncBase = (await this.deps.settingsRepository.readSyncBase?.()) ?? EMPTY_SYNC_BASE;
      const localWorkout = await this.deps.localWorkoutRepository.readSnapshot();
      const localTemplates = await this.deps.localTemplateRepository.readSnapshot();
      const localPlans = this.deps.localPlansRepository ? await this.deps.localPlansRepository.readSnapshot() : null;
      const localAccount = this.deps.localSettingsRepository ? await this.deps.localSettingsRepository.readSnapshot() : null;
      const cloudWorkout = await this.cloudWorkout().readSnapshot();
      const cloudTemplates = await this.deps.cloudTemplateRepository.readSnapshot();
      const cloudPlans = this.deps.cloudPlansRepository ? await this.deps.cloudPlansRepository.readSnapshot() : null;
      const cloudAccount = this.deps.cloudSettingsRepository ? await this.deps.cloudSettingsRepository.readSnapshot() : null;

      this.run = {
        expected: { workout: localWorkout, templates: localTemplates, plans: localPlans, settings: localAccount },
        applied: false,
      };
      const collections = this.buildCollections({
        localTemplates, cloudTemplates, localPlans, cloudPlans, localAccount, cloudAccount,
      });

      // Apply deletions first so a day deleted on one side is not restored from the other by the merge below.
      const deletions = reconcileDeletions(
        localWorkout?.data ?? {},
        localWorkout?.deletedDays ?? {},
        cloudWorkout?.data ?? {},
        cloudWorkout?.deletedDays ?? {}
      );
      const hasDeletions = Object.keys(deletions.deleteInCloud).length > 0 || deletions.deleteLocally.length > 0;
      // Merge inputs carry no tombstones: repositories read deletedDays on a write as an instruction (delete these / keep these).
      const localWorkoutMerged = localWorkout
        ? { version: localWorkout.version, updatedAt: localWorkout.updatedAt, data: deletions.local }
        : null;
      const cloudWorkoutMerged = cloudWorkout
        ? { version: cloudWorkout.version, updatedAt: cloudWorkout.updatedAt, data: deletions.cloud }
        : null;

      // Three-way decisions: what changed since both sides last agreed (base), not merely "they differ".
      const unresolvedWorkout =
        localWorkoutMerged && cloudWorkoutMerged
          ? mergeWorkoutDays(localWorkoutMerged.data, cloudWorkoutMerged.data, base.days)
          : null;
      const previews = collections.map((collection) => ({
        collection,
        merge:
          collection.local && collection.cloud
            ? mergeCollection(
                collection.toCollection(collection.local.data),
                collection.toCollection(collection.cloud.data),
                base[collection.baseKey],
                { localWinsConflicts: collection.quiet }
              )
            : null,
      }));

      // A manual sync always takes a restore point (before anything else). Automatic syncs run constantly,
      // so they only snapshot local data when they are about to change something.
      if (!automatic) {
        await this.createRestorePoint(localWorkout, localTemplates, localPlans);
      }

      const conflicts: SyncConflict[] = [];
      if (localWorkoutMerged && cloudWorkoutMerged && unresolvedWorkout && unresolvedWorkout.conflictKeys.length > 0) {
        // Scope previewPaths to only the truly conflicting dates, not the auto-mergeable ones.
        const previewPaths = unresolvedWorkout.conflictKeys
          .flatMap((key) =>
            collectDiffPaths(
              (localWorkoutMerged.data as Record<string, unknown>)[key],
              (cloudWorkoutMerged.data as Record<string, unknown>)[key],
              key
            ).slice(0, 3)
          )
          .slice(0, 12);
        conflicts.push({
          entity: "workoutData",
          localUpdatedAt: localWorkoutMerged.updatedAt,
          cloudUpdatedAt: cloudWorkoutMerged.updatedAt,
          previewPaths,
        });
      }
      for (const { collection, merge } of previews) {
        if (!merge || collection.quiet || merge.conflictKeys.length === 0) continue;
        conflicts.push({
          entity: collection.entity,
          localUpdatedAt: collection.local!.updatedAt,
          cloudUpdatedAt: collection.cloud!.updatedAt,
          previewPaths: collection.describeConflicts(
            merge.conflictKeys,
            collection.toCollection(collection.local!.data),
            collection.toCollection(collection.cloud!.data)
          ),
        });
      }

      const unresolved = conflicts.filter((conflict) => !resolution[conflict.entity]);
      if (unresolved.length > 0) {
        return {
          status: "conflict",
          conflicts: unresolved,
          message: "Conflicts detected. Choose Keep Local or Keep Cloud.",
        };
      }

      const workoutMerge =
        localWorkoutMerged && cloudWorkoutMerged
          ? mergeWorkoutDays(localWorkoutMerged.data, cloudWorkoutMerged.data, base.days, resolution.workoutData)
          : null;

      if (automatic) {
        const workoutWork =
          (localWorkoutMerged === null) !== (cloudWorkoutMerged === null) ||
          (workoutMerge !== null &&
            localWorkoutMerged !== null &&
            cloudWorkoutMerged !== null &&
            (stableSerialize(workoutMerge.merged) !== stableSerialize(localWorkoutMerged.data) ||
              stableSerialize(workoutMerge.merged) !== stableSerialize(cloudWorkoutMerged.data)));
        // Restore points cover workouts, templates and plans; a settings-only change does not need one.
        const collectionWork = previews.some(({ collection, merge }) => {
          if (collection.entity === "settings") return false;
          if ((collection.local === null) !== (collection.cloud === null)) return true;
          if (!merge || !collection.local || !collection.cloud) return false;
          const mergedData = collection.fromCollection(merge.merged);
          return (
            stableSerialize(mergedData) !== stableSerialize(collection.local.data) ||
            stableSerialize(mergedData) !== stableSerialize(collection.cloud.data)
          );
        });
        if (hasDeletions || workoutWork || collectionWork) {
          await this.createRestorePoint(localWorkout, localTemplates, localPlans);
        }
      }

      // Deletions reach the cloud first. They free room, and without that an account at its limit that deletes one day and
      // adds another could never sync: the new day would be refused before the old one was removed.
      await this.applyCloudDeletions(deletions, cloudWorkout);

      // An account limit refuses only the NEW items that do not fit. The rest of the run still completes and its result is
      // recorded, so that edits made afterwards are recognised as edits and not as clashes with an unknown ancestor. The
      // limit is reported at the end.
      let limitError: CloudLimitError | null = null;
      let finalDays: Record<string, DayData>;
      let daysBase: Record<string, string> | null = null;
      try {
        finalDays = await this.syncWorkoutData(localWorkoutMerged, cloudWorkoutMerged, workoutMerge);
      } catch (error) {
        if (!(error instanceof CloudLimitError)) throw error;
        limitError = error;
        finalDays = {};
        daysBase = await this.daysBaseAfterPartialWrite(base.days);
      }
      const nextBase: SyncBase = { days: daysBase ?? baseDaysFrom(finalDays), templates: base.templates, plans: base.plans, settings: base.settings };
      for (const collection of collections) {
        try {
          nextBase[collection.baseKey] = await this.applyCollection(collection, base[collection.baseKey], resolution[collection.entity]);
        } catch (error) {
          if (!(error instanceof CloudLimitError)) throw error;
          limitError ??= error;
          nextBase[collection.baseKey] = await this.collectionBaseAfterPartialWrite(collection, base[collection.baseKey]);
        }
      }
      await this.applyLocalDeletions(deletions, localWorkout);

      // Record what both sides now verifiably agree on for the next three-way merge (all of it, or the part that was accepted).
      await this.deps.settingsRepository.writeSyncBase?.(nextBase);
      // A hold we asked for is the point of a download-only run, not something to report as a limit.
      if (limitError && !this.uploadsHeld) throw limitError;

      const syncedAt = new Date().toISOString();
      await this.deps.settingsRepository.writeSettings({
        ...settings,
        lastSyncedAt: syncedAt,
        lastError: null,
      });

      return {
        status: "success",
        conflicts: [],
        message: "Sync completed.",
        appliedToLocal: this.run.applied,
      };
    } catch (error) {
      // Having used the sync for the period is not a failure: say when the next one opens, and do not record an error.
      if (error instanceof SyncAllowanceError) {
        return {
          status: "error",
          conflicts: [],
          message: error.message,
          reason: "allowance",
          nextAvailableAt: error.nextAvailableAt,
          ...(this.run.applied ? { appliedToLocal: true } : {}),
        };
      }
      const message =
        error instanceof Error ? error.message : "Unknown sync error";
      await this.deps.settingsRepository.writeSettings({
        ...settings,
        lastError: message,
      });
      return {
        status: "error",
        conflicts: [],
        message,
        ...(error instanceof CloudLimitError ? { reason: "storageLimit" as const } : {}),
      };
    }
  }

  private buildCollections(input: {
    localTemplates: TemplateSnapshot | null;
    cloudTemplates: TemplateSnapshot | null;
    localPlans: PlansSnapshot | null;
    cloudPlans: PlansSnapshot | null;
    localAccount: SettingsSnapshot | null;
    cloudAccount: SettingsSnapshot | null;
  }): CollectionSync[] {
    const { expected } = this.run;
    const collections: CollectionSync[] = [];

    const cloudTemplates = this.deps.cloudTemplateRepository;
    if (cloudTemplates) {
      collections.push({
        entity: "templates",
        baseKey: "templates",
        quiet: false,
        local: input.localTemplates,
        cloud: input.cloudTemplates,
        readLocal: () => this.deps.localTemplateRepository.readSnapshot(),
        readCloud: () => cloudTemplates.readSnapshot(),
        writeLocal: (next) => this.writeLocal(this.deps.localTemplateRepository, expected.templates, next as TemplateSnapshot),
        writeCloud: (next) => {
          this.assertUploadsAllowed();
          return cloudTemplates.writeSnapshot(next as TemplateSnapshot);
        },
        isValid: isTemplateSnapshot,
        toCollection: (data) => templatesToCollection(data as TemplateSnapshot["data"]),
        fromCollection: (collection) => collectionToTemplates(collection as Collection<TemplateSnapshot["data"][string]>),
        describeConflicts: (keys, local, cloud) =>
          keys.flatMap((key) => collectDiffPaths(local.items[key], cloud.items[key], key).slice(0, 3)).slice(0, 12),
      });
    }

    const localPlans = this.deps.localPlansRepository;
    const cloudPlans = this.deps.cloudPlansRepository;
    if (localPlans && cloudPlans) {
      collections.push({
        entity: "plans",
        baseKey: "plans",
        quiet: false,
        local: input.localPlans,
        cloud: input.cloudPlans,
        readLocal: () => localPlans.readSnapshot(),
        readCloud: () => cloudPlans.readSnapshot(),
        writeLocal: (next) => this.writeLocal(localPlans, expected.plans, next as PlansSnapshot),
        writeCloud: (next) => {
          this.assertUploadsAllowed();
          return cloudPlans.writeSnapshot(next as PlansSnapshot);
        },
        isValid: isPlansSnapshot,
        toCollection: (data) => plansToCollection(data as PlansSnapshot["data"]),
        fromCollection: (collection) => collectionToPlans(collection as Collection<PlansSnapshot["data"][number]>),
        // Plan ids are opaque, so name the plans that clash.
        describeConflicts: (keys, local) => keys.map((key) => (local.items[key] as { label?: string })?.label ?? key),
      });
    }

    const localAccount = this.deps.localSettingsRepository;
    const cloudAccount = this.deps.cloudSettingsRepository;
    if (localAccount && cloudAccount) {
      collections.push({
        entity: "settings",
        baseKey: "settings",
        quiet: true,
        local: input.localAccount,
        cloud: input.cloudAccount,
        readLocal: () => localAccount.readSnapshot(),
        readCloud: () => cloudAccount.readSnapshot(),
        writeLocal: (next) => this.writeLocal(localAccount, expected.settings, next as SettingsSnapshot),
        writeCloud: (next) => {
          this.assertUploadsAllowed();
          return cloudAccount.writeSnapshot(next as SettingsSnapshot);
        },
        isValid: isSettingsSnapshot,
        toCollection: (data) => settingsToCollection(data as SettingsSnapshot["data"]),
        fromCollection: (collection) => collectionToSettings(collection),
        describeConflicts: (keys) => keys,
      });
    }
    return collections;
  }

  /**
   * Syncs one keyed collection item by item and returns the base to store: the items both sides now verifiably
   * hold identically (see agreedBase).
   */
  private async applyCollection(
    collection: CollectionSync,
    baseMap: Record<string, string>,
    resolution: ConflictResolution | undefined
  ): Promise<Record<string, string>> {
    const { local, cloud } = collection;
    let finalCollection: Collection<unknown>;

    if (!local && !cloud) {
      return {};
    } else if (local && !cloud) {
      await collection.writeCloud(local);
      finalCollection = collection.toCollection(local.data);
    } else if (!local && cloud) {
      if (!collection.isValid(cloud)) {
        throw new Error(`Cloud ${collection.entity} data failed integrity check and was not written locally.`);
      }
      await collection.writeLocal(cloud);
      finalCollection = collection.toCollection(cloud.data);
    } else {
      if (!local || !cloud) return {};
      if (!collection.isValid(cloud)) {
        throw new Error(`Cloud ${collection.entity} data failed integrity check and was not written locally.`);
      }
      const { merged } = mergeCollection(
        collection.toCollection(local.data),
        collection.toCollection(cloud.data),
        baseMap,
        { resolution, localWinsConflicts: collection.quiet }
      );
      const mergedSnapshot: Snap = { version: local.version, updatedAt: new Date().toISOString(), data: collection.fromCollection(merged) };
      // An account limit refuses only new items. What came from other devices still has to reach this one, so the local
      // write goes ahead and the limit is reported afterwards.
      let refused: CloudLimitError | null = null;
      if (stableSerialize(mergedSnapshot.data) !== stableSerialize(cloud.data)) {
        try {
          await collection.writeCloud(mergedSnapshot);
        } catch (error) {
          if (!(error instanceof CloudLimitError)) throw error;
          refused = error;
        }
      }
      if (stableSerialize(mergedSnapshot.data) !== stableSerialize(local.data)) {
        await collection.writeLocal(mergedSnapshot);
      }
      if (refused) throw refused;
      finalCollection = merged;
    }

    const localAfter = await collection.readLocal();
    return agreedBase(finalCollection, localAfter ? collection.toCollection(localAfter.data) : null, baseMap);
  }

  /**
   * Finishes deletions after the merge: soft-deletes days in the cloud, removes days deleted elsewhere from
   * local storage, and clears local tombstones (every one is settled by now: applied, moot, or overridden
   * by a newer edit). A failure above throws before this point, so unsettled tombstones are retried.
   */
  private async applyCloudDeletions(
    deletions: ReturnType<typeof reconcileDeletions>,
    cloudWorkout: WorkoutDataSnapshot | null
  ): Promise<void> {
    if (this.uploadsHeld) return;
    if (Object.keys(deletions.deleteInCloud).length > 0) {
      await this.cloudWorkout().writeSnapshot({
        version: cloudWorkout?.version ?? 1,
        updatedAt: new Date().toISOString(),
        data: deletions.cloud,
        deletedDays: deletions.deleteInCloud,
      });
    }
  }

  /** The local half of finishing deletions: removes days deleted elsewhere and clears the tombstones that are settled. */
  private async applyLocalDeletions(
    deletions: ReturnType<typeof reconcileDeletions>,
    localWorkout: WorkoutDataSnapshot | null
  ): Promise<void> {
    const hadTombstones = Object.keys(localWorkout?.deletedDays ?? {}).length > 0;
    if (deletions.deleteLocally.length === 0 && !hadTombstones) {
      return;
    }
    // Read-then-write with no network in between, so no extra conflict guard is needed here.
    const current = await this.deps.localWorkoutRepository.readSnapshot();
    if (!current) {
      return;
    }
    const data = { ...current.data };
    for (const date of deletions.deleteLocally) {
      delete data[date];
    }
    // A deletion this device made is only settled once the cloud has it. While uploads are held it has not, so keep the tombstones.
    await this.deps.localWorkoutRepository.writeSnapshot({ ...current, data, deletedDays: this.uploadsHeld ? (current.deletedDays ?? {}) : {} });
    if (deletions.deleteLocally.length > 0) {
      this.run.applied = true;
    }
  }

  /** The cloud workout repository for this run: limited to the plan's history window when it has one. */
  private cloudWorkout(): WorkoutDataRepository {
    const cloud = this.limitedCloud ?? this.deps.cloudWorkoutRepository;
    if (!cloud) throw new Error("Cloud sync is not configured.");
    return cloud;
  }

  /** Every write to the cloud goes through here first. */
  private assertUploadsAllowed(): void {
    if (this.uploadsHeld) throw new SyncAllowanceError(null, "Uploads are held back for this sync.");
  }

  /** After a refused write of workout days: the base from what the cloud and this device really hold now. */
  private async daysBaseAfterPartialWrite(previous: Record<string, string>): Promise<Record<string, string>> {
    const [cloud, local] = await Promise.all([
      this.cloudWorkout()?.readSnapshot() ?? null,
      this.deps.localWorkoutRepository.readSnapshot(),
    ]);
    return baseAfterPartialWrite(previous, baseDaysFrom(cloud?.data ?? {}), baseDaysFrom(local?.data ?? {}));
  }

  /** After a refused write of a collection: the base from what the cloud and this device really hold now. */
  private async collectionBaseAfterPartialWrite(
    collection: CollectionSync,
    previous: Record<string, string>
  ): Promise<Record<string, string>> {
    const [cloud, local] = await Promise.all([collection.readCloud(), collection.readLocal()]);
    return baseAfterPartialWrite(
      previous,
      collectionHashes(cloud ? collection.toCollection(cloud.data) : null),
      collectionHashes(local ? collection.toCollection(local.data) : null)
    );
  }

  private async createRestorePoint(
    workoutData: WorkoutDataSnapshot | null,
    templates: TemplateSnapshot | null,
    plans: PlansSnapshot | null
  ): Promise<void> {
    const existing = await this.getRestorePoints();
    const next: SyncRestorePoint = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      workoutData,
      templates,
      plans,
    };
    const updated = [next, ...existing].slice(0, 10);
    await this.deps.settingsRepository.writeRestorePoints(updated);
  }

  /** Returns the days both sides agree on after this sync (the new base). */
  private async syncWorkoutData(
    local: WorkoutDataSnapshot | null,
    cloud: WorkoutDataSnapshot | null,
    merge: { merged: Record<string, DayData> } | null
  ): Promise<Record<string, DayData>> {
    if (!this.cloudWorkout()) {
      return {};
    }

    if (local && !cloud) {
      this.assertUploadsAllowed();
      await this.cloudWorkout().writeSnapshot(local);
      return local.data;
    }
    if (!local && cloud) {
      if (!isWorkoutDataSnapshot(cloud)) {
        throw new Error("Cloud workout data failed integrity check and was not written locally.");
      }
      await this.writeLocal(this.deps.localWorkoutRepository, this.run.expected.workout, cloud);
      return cloud.data;
    }
    if (!local || !cloud || !merge) {
      return {};
    }

    const merged: WorkoutDataSnapshot = { version: local.version, updatedAt: new Date().toISOString(), data: merge.merged };
    // See applyCollection: a refused new day must not keep days from other devices from reaching this one.
    let refused: CloudLimitError | null = null;
    if (stableSerialize(merge.merged) !== stableSerialize(cloud.data)) {
      try {
        this.assertUploadsAllowed();
        await this.cloudWorkout().writeSnapshot(merged);
      } catch (error) {
        if (!(error instanceof CloudLimitError)) throw error;
        refused = error;
      }
    }
    if (stableSerialize(merge.merged) !== stableSerialize(local.data)) {
      await this.writeLocal(this.deps.localWorkoutRepository, this.run.expected.workout, merged);
    }
    if (refused) throw refused;
    return merge.merged;
  }
}
