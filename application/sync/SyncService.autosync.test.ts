import { describe, expect, it } from "vitest";
import { SyncService } from "./SyncService";
import { SyncSettings, SyncSettingsRepository } from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { PlansSnapshot, TemplateSnapshot, WorkoutDataSnapshot } from "./syncTypes";
import { Tombstones } from "./deletionReconciliation";
import { dayContentHash } from "./contentHash";
import { EMPTY_SYNC_BASE, SyncBase } from "./syncMerge";
import { CloudLimitError, describeLimit } from "./syncErrors";
import { DayData, Plan } from "../../types";
import { createEmptyDay } from "../../utils";
import { TEMPLATES } from "../../constants";

const D1 = "2026-10-01";
const D2 = "2026-10-02";
const D3 = "2026-10-03";

// createEmptyDay generates random item ids; fixtures must be deterministic so equal days hash equal.
function day(date: string, notes = ""): DayData {
  const base = createEmptyDay(date, "gym", TEMPLATES);
  return {
    ...base,
    warmup: base.warmup.map((item, i) => ({ ...item, id: `${date}-w${i}` })),
    main: base.main.map((item, i) => ({ ...item, id: `${date}-m${i}` })),
    mainNotes: notes,
  };
}

function snapshot(data: Record<string, DayData>): WorkoutDataSnapshot {
  return { version: 1, updatedAt: "2026-10-01T10:00:00.000Z", data };
}

/** Mirrors LocalStorageWorkoutDataRepository's tombstone rules. */
class FakeLocalWorkout implements WorkoutDataRepository {
  public data: Record<string, DayData>;
  public tombstones: Tombstones = {};
  public writes = 0;

  public constructor(data: Record<string, DayData>) {
    this.data = { ...data };
  }

  public async readAll() { return this.data; }
  public async writeAll(data: Record<string, DayData>) { await this.writeSnapshot(snapshot(data)); }
  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    return { ...snapshot({ ...this.data }), deletedDays: { ...this.tombstones } };
  }
  public async writeSnapshot(next: WorkoutDataSnapshot) {
    this.writes += 1;
    this.data = { ...next.data };
    for (const date of Object.keys(this.data)) delete this.tombstones[date];
    if (next.deletedDays) {
      for (const date of Object.keys(this.tombstones)) if (!(date in next.deletedDays)) delete this.tombstones[date];
    }
  }
  public async recordDeletion(date: string, removed: DayData) {
    this.tombstones[date] = dayContentHash(removed);
  }
  /** What the UI does when the user deletes a day. */
  public async userDeletes(date: string) {
    await this.recordDeletion(date, this.data[date]);
    delete this.data[date];
  }
}

/** Mirrors the Postgres repository: live rows, soft-deleted rows, upserts un-delete. */
class FakeCloudWorkout implements WorkoutDataRepository {
  public live: Record<string, DayData>;
  public deleted: Tombstones = {};
  public reads = 0;
  public onRead: (() => Promise<void>) | null = null;
  public failWritesWith: Error | null = null;

  public constructor(live: Record<string, DayData>, deleted: Tombstones = {}) {
    this.live = { ...live };
    this.deleted = { ...deleted };
  }

  public async readAll() { return this.live; }
  public async writeAll(data: Record<string, DayData>) { await this.writeSnapshot(snapshot(data)); }
  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    this.reads += 1;
    if (this.onRead) await this.onRead();
    if (Object.keys(this.live).length === 0 && Object.keys(this.deleted).length === 0) return null;
    return { ...snapshot({ ...this.live }), deletedDays: { ...this.deleted } };
  }
  public async writeSnapshot(next: WorkoutDataSnapshot) {
    if (this.failWritesWith) throw this.failWritesWith;
    for (const [date, value] of Object.entries(next.data)) {
      if (dayContentHash(value) !== dayContentHash(this.live[date] ?? ({} as DayData))) {
        this.live[date] = value;
        delete this.deleted[date];
      }
    }
    for (const date of Object.keys(next.deletedDays ?? {})) {
      if (this.live[date]) {
        this.deleted[date] = dayContentHash(this.live[date]);
        delete this.live[date];
      }
    }
  }
}

class FakeTemplates implements TemplateRepository {
  public async readTemplates() { return null; }
  public async writeTemplates() {}
  public async readSnapshot(): Promise<TemplateSnapshot | null> { return null; }
  public async writeSnapshot() {}
}

class FakePlans implements PlansRepository {
  public async readPlans(): Promise<Plan[]> { return []; }
  public async writePlans() {}
  public async readActivePlanId() { return null; }
  public async writeActivePlanId() {}
  public async readSnapshot(): Promise<PlansSnapshot | null> { return null; }
  public async writeSnapshot() {}
}

class FakeSettings implements SyncSettingsRepository {
  public settings: SyncSettings = { mode: "cloud", lastSyncedAt: null, lastError: null };
  public restorePoints: Array<{ id: string; createdAt: string; workoutData: unknown; templates: unknown; plans?: unknown }> = [];
  public base: SyncBase = EMPTY_SYNC_BASE;
  public async readSyncBase() { return this.base; }
  public async writeSyncBase(base: SyncBase) { this.base = base; }
  public async readSettings() { return this.settings; }
  public async writeSettings(settings: SyncSettings) { this.settings = settings; }
  public async readRestorePoints() { return this.restorePoints; }
  public async writeRestorePoints(points: typeof this.restorePoints) { this.restorePoints = points; }
}

function setup(local: FakeLocalWorkout, cloud: FakeCloudWorkout) {
  const settings = new FakeSettings();
  const service = new SyncService({
    settingsRepository: settings,
    localWorkoutRepository: local,
    localTemplateRepository: new FakeTemplates(),
    cloudWorkoutRepository: cloud,
    cloudTemplateRepository: new FakeTemplates(),
    localPlansRepository: new FakePlans(),
    cloudPlansRepository: new FakePlans(),
  });
  return { service, settings };
}

describe("SyncService: deletions", () => {
  it("deleting a day locally deletes it in the cloud and it does not come back", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "keep me not"), [D2]: day(D2, "stay") });
    const cloud = new FakeCloudWorkout({ [D1]: day(D1, "keep me not"), [D2]: day(D2, "stay") });
    const { service } = setup(local, cloud);

    await local.userDeletes(D1);
    const result = await service.syncNow();

    expect(result.status).toBe("success");
    expect(Object.keys(cloud.live)).toEqual([D2]);
    expect(Object.keys(cloud.deleted)).toEqual([D1]);
    expect(Object.keys(local.data)).toEqual([D2]);
    expect(local.tombstones).toEqual({});

    await service.syncNow();
    expect(Object.keys(local.data)).toEqual([D2]);
    expect(Object.keys(cloud.live)).toEqual([D2]);
  });

  it("a day deleted on another device is removed here when our copy is unchanged", async () => {
    const original = day(D1, "same");
    const local = new FakeLocalWorkout({ [D1]: original, [D2]: day(D2) });
    const cloud = new FakeCloudWorkout({ [D2]: day(D2) }, { [D1]: dayContentHash(original) });
    const { service } = setup(local, cloud);

    const result = await service.syncNow();

    expect(Object.keys(local.data)).toEqual([D2]);
    expect(result.appliedToLocal).toBe(true);
  });

  it("an edit made here after the other device deleted the day wins and restores it", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "edited here") });
    const cloud = new FakeCloudWorkout({}, { [D1]: dayContentHash(day(D1, "original")) });
    const { service } = setup(local, cloud);

    await service.syncNow();

    expect(local.data[D1].mainNotes).toBe("edited here");
    expect(cloud.live[D1].mainNotes).toBe("edited here");
    expect(cloud.deleted[D1]).toBeUndefined();
  });

  it("an edit made elsewhere after we deleted the day wins and brings it back", async () => {
    const local = new FakeLocalWorkout({});
    local.tombstones[D1] = dayContentHash(day(D1, "original"));
    const cloud = new FakeCloudWorkout({ [D1]: day(D1, "edited elsewhere") });
    const { service } = setup(local, cloud);

    await service.syncNow();

    expect(local.data[D1].mainNotes).toBe("edited elsewhere");
    expect(cloud.live[D1].mainNotes).toBe("edited elsewhere");
  });
});

describe("SyncService: three-way merge", () => {
  it("an ordinary edit to an already-synced day is pushed, not reported as a conflict", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "v1") });
    const cloud = new FakeCloudWorkout({});
    const { service } = setup(local, cloud);
    expect((await service.syncNow({}, { automatic: true })).status).toBe("success");
    expect(cloud.live[D1].mainNotes).toBe("v1");

    local.data[D1] = day(D1, "v2");
    const result = await service.syncNow({}, { automatic: true });

    expect(result.status).toBe("success");
    expect(cloud.live[D1].mainNotes).toBe("v2");
  });

  it("an edit made on another device is pulled, not reported as a conflict", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "v1") });
    const cloud = new FakeCloudWorkout({});
    const { service } = setup(local, cloud);
    await service.syncNow({}, { automatic: true });

    cloud.live[D1] = day(D1, "edited elsewhere");
    const result = await service.syncNow({}, { automatic: true });

    expect(result.status).toBe("success");
    expect(local.data[D1].mainNotes).toBe("edited elsewhere");
    expect(result.appliedToLocal).toBe(true);
  });

  it("reports a conflict only when both sides edited the same day", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "v1") });
    const cloud = new FakeCloudWorkout({});
    const { service } = setup(local, cloud);
    await service.syncNow({}, { automatic: true });

    local.data[D1] = day(D1, "mine");
    cloud.live[D1] = day(D1, "theirs");
    const result = await service.syncNow({}, { automatic: true });

    expect(result.status).toBe("conflict");
    expect(result.conflicts[0].entity).toBe("workoutData");
    expect(local.data[D1].mainNotes).toBe("mine");
    expect(cloud.live[D1].mainNotes).toBe("theirs");

    const resolved = await service.syncNow({ workoutData: "keepCloud" });
    expect(resolved.status).toBe("success");
    expect(local.data[D1].mainNotes).toBe("theirs");
  });
});

describe("SyncService: storage limit", () => {
  it("reports a storage-limit failure distinctly, keeps local data, and recovers once there is room", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "mine") });
    const cloud = new FakeCloudWorkout({});
    cloud.failWritesWith = new CloudLimitError("workout_days", describeLimit("workout_days"));
    const { service, settings } = setup(local, cloud);

    const result = await service.syncNow({}, { automatic: true });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("storageLimit");
    expect(result.message).toContain("storage limit");
    expect(settings.settings.lastError).toBe(result.message);
    expect(local.data[D1].mainNotes).toBe("mine");
    expect(cloud.live).toEqual({});

    cloud.failWritesWith = null;
    const retry = await service.syncNow({}, { automatic: true });
    expect(retry.status).toBe("success");
    expect(retry.reason).toBeUndefined();
    expect(cloud.live[D1].mainNotes).toBe("mine");
    expect(settings.settings.lastError).toBeNull();
  });

  it("does not tag ordinary failures as storage-limit", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1) });
    const cloud = new FakeCloudWorkout({});
    cloud.failWritesWith = new Error("network down");
    const { service } = setup(local, cloud);

    const result = await service.syncNow({}, { automatic: true });

    expect(result.status).toBe("error");
    expect(result.reason).toBeUndefined();
  });
});

describe("SyncService: automatic sync safety", () => {
  it("does not overwrite an edit the user made while the sync was in flight", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1, "before") });
    const cloud = new FakeCloudWorkout({ [D1]: day(D1, "before"), [D3]: day(D3, "from another device") });
    const { service } = setup(local, cloud);

    // The user types while the cloud read is in flight.
    cloud.onRead = async () => {
      cloud.onRead = null;
      local.data[D1] = day(D1, "typed during sync");
    };
    const result = await service.syncNow();

    expect(local.data[D1].mainNotes).toBe("typed during sync");
    expect(result.appliedToLocal).toBe(false);

    // The next run (triggered by the edit) picks everything up.
    const next = await service.syncNow();
    expect(local.data[D3].mainNotes).toBe("from another device");
    expect(cloud.live[D1].mainNotes).toBe("typed during sync");
    expect(next.appliedToLocal).toBe(true);
  });

  it("reports appliedToLocal only when local data actually changed", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1) });
    const cloud = new FakeCloudWorkout({ [D1]: day(D1) });
    const { service } = setup(local, cloud);
    expect((await service.syncNow({}, { automatic: true })).appliedToLocal).toBe(false);

    cloud.live[D2] = day(D2, "new elsewhere");
    expect((await service.syncNow({}, { automatic: true })).appliedToLocal).toBe(true);
  });

  it("automatic syncs take no restore point when nothing changes, manual syncs always do", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1) });
    const cloud = new FakeCloudWorkout({ [D1]: day(D1) });
    const { service, settings } = setup(local, cloud);

    await service.syncNow({}, { automatic: true });
    await service.syncNow({}, { automatic: true });
    expect(settings.restorePoints).toHaveLength(0);

    await service.syncNow();
    expect(settings.restorePoints).toHaveLength(1);
  });

  it("automatic syncs do take a restore point when they are about to change data", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1) });
    const cloud = new FakeCloudWorkout({ [D1]: day(D1), [D2]: day(D2, "remote") });
    const { service, settings } = setup(local, cloud);

    await service.syncNow({}, { automatic: true });
    expect(settings.restorePoints).toHaveLength(1);
  });

  it("concurrent calls share one run", async () => {
    const local = new FakeLocalWorkout({ [D1]: day(D1) });
    const cloud = new FakeCloudWorkout({ [D1]: day(D1) });
    const { service } = setup(local, cloud);

    const [a, b] = await Promise.all([service.syncNow({}, { automatic: true }), service.syncNow({}, { automatic: true })]);

    expect(cloud.reads).toBe(1);
    expect(a).toBe(b);
  });
});
