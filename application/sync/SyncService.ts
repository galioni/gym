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
  SyncConflict,
  SyncRestorePoint,
  SyncEntity,
  SyncNowResult,
  TemplateSnapshot,
  WorkoutDataSnapshot,
} from "./syncTypes";
import { CloudApiPaymentRequiredError } from "../../infrastructure/workout/cloud/cloudApiError";

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
  localWorkoutRepository: WorkoutDataRepository;
  localTemplateRepository: TemplateRepository;
  cloudWorkoutRepository: WorkoutDataRepository | null;
  cloudTemplateRepository: TemplateRepository | null;
  localPlansRepository?: PlansRepository | null;
  cloudPlansRepository?: PlansRepository | null;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`);
  return `{${entries.join(",")}}`;
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

function hasConflict<T extends { updatedAt: string; data: unknown }>(
  local: T | null,
  cloud: T | null
): boolean {
  if (!local || !cloud) {
    return false;
  }
  return stableSerialize(local.data) !== stableSerialize(cloud.data);
}

export class SyncService {
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

  public async syncNow(
    resolution: ConflictResolutionMap = {}
  ): Promise<SyncNowResult> {
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
      const localWorkout = await this.deps.localWorkoutRepository.readSnapshot();
      const localTemplates = await this.deps.localTemplateRepository.readSnapshot();
      const localPlans = this.deps.localPlansRepository ? await this.deps.localPlansRepository.readSnapshot() : null;
      const cloudWorkout = await this.deps.cloudWorkoutRepository.readSnapshot();
      const cloudTemplates = await this.deps.cloudTemplateRepository.readSnapshot();
      const cloudPlans = this.deps.cloudPlansRepository ? await this.deps.cloudPlansRepository.readSnapshot() : null;

      await this.createRestorePoint(localWorkout, localTemplates, localPlans);

      const conflicts: SyncConflict[] = [];
      if (hasConflict(localWorkout, cloudWorkout)) {
        conflicts.push({
          entity: "workoutData",
          localUpdatedAt: localWorkout!.updatedAt,
          cloudUpdatedAt: cloudWorkout!.updatedAt,
          previewPaths: collectDiffPaths(localWorkout?.data, cloudWorkout?.data).slice(0, 12),
        });
      }
      if (hasConflict(localTemplates, cloudTemplates)) {
        conflicts.push({
          entity: "templates",
          localUpdatedAt: localTemplates!.updatedAt,
          cloudUpdatedAt: cloudTemplates!.updatedAt,
          previewPaths: collectDiffPaths(localTemplates?.data, cloudTemplates?.data).slice(0, 12),
        });
      }
      if (this.deps.localPlansRepository && this.deps.cloudPlansRepository && hasConflict(localPlans, cloudPlans)) {
        conflicts.push({
          entity: "plans",
          localUpdatedAt: localPlans!.updatedAt,
          cloudUpdatedAt: cloudPlans!.updatedAt,
          previewPaths: collectDiffPaths(localPlans?.data, cloudPlans?.data).slice(0, 12),
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

      await this.syncWorkoutData(localWorkout, cloudWorkout, resolution.workoutData);
      await this.syncTemplates(localTemplates, cloudTemplates, resolution.templates);
      await this.syncPlans(localPlans, cloudPlans, resolution.plans);

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
      };
    } catch (error) {
      if (error instanceof CloudApiPaymentRequiredError) {
        return {
          status: "upgradeRequired",
          conflicts: [],
          message: "Cloud sync requires a Pro subscription.",
        };
      }
      const message =
        error instanceof Error ? error.message : "Unknown sync error";
      await this.deps.settingsRepository.writeSettings({
        ...settings,
        lastError: message,
      });
      return { status: "error", conflicts: [], message };
    }
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

  private async syncWorkoutData(
    local: WorkoutDataSnapshot | null,
    cloud: WorkoutDataSnapshot | null,
    resolution: ConflictResolution | undefined
  ): Promise<void> {
    if (!this.deps.cloudWorkoutRepository) {
      return;
    }

    if (local && !cloud) {
      await this.deps.cloudWorkoutRepository.writeSnapshot(local);
      return;
    }
    if (!local && cloud) {
      if (!isWorkoutDataSnapshot(cloud)) {
        throw new Error("Cloud workout data failed integrity check and was not written locally.");
      }
      await this.deps.localWorkoutRepository.writeSnapshot(cloud);
      return;
    }
    if (!local || !cloud) {
      return;
    }

    if (stableSerialize(local.data) === stableSerialize(cloud.data)) {
      if (local.updatedAt >= cloud.updatedAt) {
        await this.deps.cloudWorkoutRepository.writeSnapshot(local);
      } else {
        if (!isWorkoutDataSnapshot(cloud)) {
          throw new Error("Cloud workout data failed integrity check and was not written locally.");
        }
        await this.deps.localWorkoutRepository.writeSnapshot(cloud);
      }
      return;
    }

    if (resolution === "keepLocal") {
      await this.deps.cloudWorkoutRepository.writeSnapshot(local);
    } else if (resolution === "keepCloud") {
      if (!isWorkoutDataSnapshot(cloud)) {
        throw new Error("Cloud workout data failed integrity check and was not written locally.");
      }
      await this.deps.localWorkoutRepository.writeSnapshot(cloud);
    }
  }

  private async syncTemplates(
    local: TemplateSnapshot | null,
    cloud: TemplateSnapshot | null,
    resolution: ConflictResolution | undefined
  ): Promise<void> {
    if (!this.deps.cloudTemplateRepository) {
      return;
    }

    if (local && !cloud) {
      await this.deps.cloudTemplateRepository.writeSnapshot(local);
      return;
    }
    if (!local && cloud) {
      if (!isTemplateSnapshot(cloud)) {
        throw new Error("Cloud template data failed integrity check and was not written locally.");
      }
      await this.deps.localTemplateRepository.writeSnapshot(cloud);
      return;
    }
    if (!local || !cloud) {
      return;
    }

    if (stableSerialize(local.data) === stableSerialize(cloud.data)) {
      if (local.updatedAt >= cloud.updatedAt) {
        await this.deps.cloudTemplateRepository.writeSnapshot(local);
      } else {
        if (!isTemplateSnapshot(cloud)) {
          throw new Error("Cloud template data failed integrity check and was not written locally.");
        }
        await this.deps.localTemplateRepository.writeSnapshot(cloud);
      }
      return;
    }

    if (resolution === "keepLocal") {
      await this.deps.cloudTemplateRepository.writeSnapshot(local);
    } else if (resolution === "keepCloud") {
      if (!isTemplateSnapshot(cloud)) {
        throw new Error("Cloud template data failed integrity check and was not written locally.");
      }
      await this.deps.localTemplateRepository.writeSnapshot(cloud);
    }
  }

  private async syncPlans(
    local: PlansSnapshot | null,
    cloud: PlansSnapshot | null,
    resolution: ConflictResolution | undefined
  ): Promise<void> {
    if (!this.deps.localPlansRepository || !this.deps.cloudPlansRepository) {
      return;
    }

    if (local && !cloud) {
      await this.deps.cloudPlansRepository.writeSnapshot(local);
      return;
    }
    if (!local && cloud) {
      if (!isPlansSnapshot(cloud)) {
        throw new Error("Cloud plans data failed integrity check and was not written locally.");
      }
      await this.deps.localPlansRepository.writeSnapshot(cloud);
      return;
    }
    if (!local || !cloud) {
      return;
    }

    if (stableSerialize(local.data) === stableSerialize(cloud.data)) {
      if (local.updatedAt >= cloud.updatedAt) {
        await this.deps.cloudPlansRepository.writeSnapshot(local);
      } else {
        if (!isPlansSnapshot(cloud)) {
          throw new Error("Cloud plans data failed integrity check and was not written locally.");
        }
        await this.deps.localPlansRepository.writeSnapshot(cloud);
      }
      return;
    }

    if (resolution === "keepLocal") {
      await this.deps.cloudPlansRepository.writeSnapshot(local);
    } else if (resolution === "keepCloud") {
      if (!isPlansSnapshot(cloud)) {
        throw new Error("Cloud plans data failed integrity check and was not written locally.");
      }
      await this.deps.localPlansRepository.writeSnapshot(cloud);
    }
  }
}
