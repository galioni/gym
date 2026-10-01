import { describe, expect, it } from "vitest";
import { SyncService } from "./SyncService";
import { SyncSettings, SyncSettingsRepository } from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { AccountSettingsRepository } from "../../interfaces/workout/AccountSettingsRepository";
import { PlansSnapshot, SettingsSnapshot, SyncedSettings, TemplateSnapshot, WorkoutDataSnapshot } from "./syncTypes";
import { EMPTY_SYNC_BASE, SyncBase } from "./syncMerge";
import { Plan, TemplateData, Templates } from "../../types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const stamp = () => new Date().toISOString();

const tpl = (text: string): TemplateData => ({ warmup: [], main: [{ text, target: "3x8" }] });

// ---- minimal stateful repositories -------------------------------------------------------------------------

class NoWorkouts implements WorkoutDataRepository {
  public async readAll() { return {}; }
  public async writeAll() {}
  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> { return null; }
  public async writeSnapshot() {}
}

class MemTemplates implements TemplateRepository {
  public snapshot: TemplateSnapshot | null = null;
  public onRead: (() => void) | null = null;
  public set(data: Templates | null) { this.snapshot = data === null ? null : { version: 1, updatedAt: stamp(), data: clone(data) }; }
  public get data(): Templates { return this.snapshot?.data ?? {}; }
  public async readTemplates() { return this.snapshot?.data ?? null; }
  public async writeTemplates() {}
  public async readSnapshot() { this.onRead?.(); return this.snapshot ? clone(this.snapshot) : null; }
  public async writeSnapshot(next: TemplateSnapshot) { this.snapshot = clone(next); }
}

class MemPlans implements PlansRepository {
  public snapshot: PlansSnapshot | null = null;
  public set(data: Plan[] | null) { this.snapshot = data === null ? null : { version: 1, updatedAt: stamp(), data: clone(data) }; }
  public get data(): Plan[] { return this.snapshot?.data ?? []; }
  public async readPlans() { return this.data; }
  public async writePlans() {}
  public async readActivePlanId() { return null; }
  public async writeActivePlanId() {}
  public async readSnapshot() { return this.snapshot ? clone(this.snapshot) : null; }
  public async writeSnapshot(next: PlansSnapshot) { this.snapshot = clone(next); }
}

class MemAccount implements AccountSettingsRepository {
  public snapshot: SettingsSnapshot | null;
  public constructor(initial: SyncedSettings | null) { this.snapshot = initial ? { version: 1, updatedAt: stamp(), data: clone(initial) } : null; }
  public set(data: Partial<SyncedSettings>) {
    this.snapshot = { version: 1, updatedAt: stamp(), data: { activePlanId: null, planParams: null, planMeta: null, ...this.snapshot?.data, ...data } };
  }
  public get data(): SyncedSettings { return this.snapshot?.data ?? { activePlanId: null, planParams: null, planMeta: null }; }
  public async readSnapshot() { return this.snapshot ? clone(this.snapshot) : null; }
  public async writeSnapshot(next: SettingsSnapshot) { this.snapshot = clone(next); }
}

class MemSyncSettings implements SyncSettingsRepository {
  public settings: SyncSettings = { mode: "cloud", lastSyncedAt: null, lastError: null };
  public base: SyncBase = EMPTY_SYNC_BASE;
  public restorePoints: Array<{ id: string; createdAt: string; workoutData: unknown; templates: unknown; plans?: unknown }> = [];
  public async readSettings() { return this.settings; }
  public async writeSettings(settings: SyncSettings) { this.settings = settings; }
  public async readSyncBase() { return this.base; }
  public async writeSyncBase(base: SyncBase) { this.base = base; }
  public async readRestorePoints() { return this.restorePoints; }
  public async writeRestorePoints(points: typeof this.restorePoints) { this.restorePoints = points; }
}

/** One account's cloud, shared by every device. */
function newCloud() {
  return { templates: new MemTemplates(), plans: new MemPlans(), account: new MemAccount(null) };
}

/** One device: its own local storage and sync bookkeeping, pointing at the shared cloud. */
function newDevice(cloud: ReturnType<typeof newCloud>) {
  const templates = new MemTemplates();
  const plans = new MemPlans();
  const account = new MemAccount({ activePlanId: null, planParams: null, planMeta: null });
  const settings = new MemSyncSettings();
  const service = new SyncService({
    settingsRepository: settings,
    localWorkoutRepository: new NoWorkouts(),
    localTemplateRepository: templates,
    cloudWorkoutRepository: new NoWorkouts(),
    cloudTemplateRepository: cloud.templates,
    localPlansRepository: plans,
    cloudPlansRepository: cloud.plans,
    localSettingsRepository: account,
    cloudSettingsRepository: cloud.account,
  });
  return { templates, plans, account, settings, sync: (resolution = {}, automatic = true) => service.syncNow(resolution, { automatic }) };
}

// ---- templates -----------------------------------------------------------------------------------------------

describe("per-item sync of templates", () => {
  it("a new device receives the account's templates", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    a.templates.set({ push: tpl("Bench"), legs: tpl("Squat") });
    await a.sync();

    const b = newDevice(cloud);
    const result = await b.sync();

    expect(Object.keys(b.templates.data)).toEqual(["push", "legs"]);
    expect(result.appliedToLocal).toBe(true);
  });

  it("different templates edited on two devices merge with no conflict", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.templates.set({ push: tpl("Bench"), legs: tpl("Squat") });
    await a.sync();
    await b.sync();

    a.templates.set({ push: tpl("Incline bench"), legs: tpl("Squat") });
    b.templates.set({ push: tpl("Bench"), legs: tpl("Front squat") });
    await a.sync();
    const result = await b.sync();
    await a.sync();

    expect(result.status).toBe("success");
    expect(b.templates.data.push.main[0].text).toBe("Incline bench");
    expect(b.templates.data.legs.main[0].text).toBe("Front squat");
    expect(a.templates.data.legs.main[0].text).toBe("Front squat");
    expect(cloud.templates.data.push.main[0].text).toBe("Incline bench");
  });

  it("reports a conflict only for the template edited on both devices, naming it", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.templates.set({ push: tpl("Bench"), legs: tpl("Squat") });
    await a.sync();
    await b.sync();

    a.templates.set({ push: tpl("A's bench"), legs: tpl("Squat") });
    b.templates.set({ push: tpl("B's bench"), legs: tpl("B's squat") });
    await a.sync();
    const result = await b.sync();

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].entity).toBe("templates");
    expect(result.conflicts[0].previewPaths.every((path) => path.startsWith("push"))).toBe(true);
    // nothing was overwritten while the user decides
    expect(b.templates.data.legs.main[0].text).toBe("B's squat");
    expect(cloud.templates.data.push.main[0].text).toBe("A's bench");

    const resolved = await b.sync({ templates: "keepCloud" });
    expect(resolved.status).toBe("success");
    expect(b.templates.data.push.main[0].text).toBe("A's bench");
    expect(b.templates.data.legs.main[0].text).toBe("B's squat");
  });

  it("a template deleted on one device is deleted on the other", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.templates.set({ push: tpl("Bench"), legs: tpl("Squat") });
    await a.sync();
    await b.sync();

    a.templates.set({ push: tpl("Bench") });
    await a.sync();
    await b.sync();

    expect(Object.keys(b.templates.data)).toEqual(["push"]);
    expect(Object.keys(cloud.templates.data)).toEqual(["push"]);
  });

  it("an edit made on one device beats a deletion on the other", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.templates.set({ push: tpl("Bench"), legs: tpl("Squat") });
    await a.sync();
    await b.sync();

    a.templates.set({ push: tpl("Bench") });
    b.templates.set({ push: tpl("Bench"), legs: tpl("Heavy squat") });
    await a.sync();
    const result = await b.sync();

    expect(result.status).toBe("success");
    expect(b.templates.data.legs.main[0].text).toBe("Heavy squat");
    expect(cloud.templates.data.legs.main[0].text).toBe("Heavy squat");
  });

  it("a pull skipped because the user edited mid-sync is never mistaken for a deletion later", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.templates.set({ push: tpl("Bench") });
    await a.sync();
    await b.sync();

    // A adds a template; while B syncs, the user on B types a change, so B's pull of the new template is skipped.
    a.templates.set({ push: tpl("Bench"), arms: tpl("Curls") });
    await a.sync();
    // The user types on B while B's sync is waiting for the cloud (after it has already read B's local data).
    cloud.templates.onRead = () => {
      cloud.templates.onRead = null;
      b.templates.set({ push: tpl("Bench"), core: tpl("Plank") });
    };
    await b.sync();
    expect(b.templates.data.arms).toBeUndefined();
    expect(b.templates.data.core).toBeDefined();

    // The next sync must pull "arms" and push "core"; it must not decide that B deleted "arms".
    await b.sync();
    await a.sync();

    expect(Object.keys(b.templates.data).sort()).toEqual(["arms", "core", "push"]);
    expect(Object.keys(cloud.templates.data).sort()).toEqual(["arms", "core", "push"]);
    expect(Object.keys(a.templates.data).sort()).toEqual(["arms", "core", "push"]);
  });

  it("does not treat an inherited property name as an existing template", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    a.templates.set({ push: tpl("Bench") });
    await a.sync();
    const b = newDevice(cloud);
    b.templates.set({ constructor: tpl("Odd name") });
    const result = await b.sync();
    expect(result.status).toBe("success");
    expect(Object.keys(cloud.templates.data).sort()).toEqual(["constructor", "push"]);
  });
});

// ---- plans ---------------------------------------------------------------------------------------------------

describe("per-item sync of plans", () => {
  const plan = (id: string, label: string): Plan => ({ id, label, sessionIds: ["push"] });

  it("plans added on each device are combined, keeping each device's order first", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.plans.set([plan("p1", "Strength")]);
    await a.sync();
    await b.sync();

    a.plans.set([plan("p1", "Strength"), plan("p2", "Cardio")]);
    b.plans.set([plan("p1", "Strength"), plan("p3", "Mobility")]);
    await a.sync();
    const result = await b.sync();
    await a.sync();

    expect(result.status).toBe("success");
    expect(b.plans.data.map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
    expect(a.plans.data.map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("a rename on one device and a different plan edited on the other do not conflict; the same plan does, by name", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.plans.set([plan("p1", "Strength"), plan("p2", "Cardio")]);
    await a.sync();
    await b.sync();

    a.plans.set([plan("p1", "Strength v2"), plan("p2", "Cardio")]);
    b.plans.set([plan("p1", "Strength"), plan("p2", "Cardio v2")]);
    await a.sync();
    const merged = await b.sync();
    expect(merged.status).toBe("success");
    expect(b.plans.data.map((p) => p.label)).toEqual(["Strength v2", "Cardio v2"]);

    await a.sync();
    a.plans.set([plan("p1", "From A"), plan("p2", "Cardio v2")]);
    b.plans.set([plan("p1", "From B"), plan("p2", "Cardio v2")]);
    await a.sync();
    const clash = await b.sync();
    expect(clash.status).toBe("conflict");
    expect(clash.conflicts[0].entity).toBe("plans");
    expect(clash.conflicts[0].previewPaths).toEqual(["From B"]);
  });

  it("deleting a plan on one device removes it on the other", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.plans.set([plan("p1", "Strength"), plan("p2", "Cardio")]);
    await a.sync();
    await b.sync();

    a.plans.set([plan("p1", "Strength")]);
    await a.sync();
    await b.sync();

    expect(b.plans.data.map((p) => p.id)).toEqual(["p1"]);
  });
});

// ---- account settings ----------------------------------------------------------------------------------------

describe("account settings follow the user", () => {
  const params = { goal: "strength", experience: "beginner", daysPerWeek: 3, equipment: "full_gym", duration: "45", bodyFocus: [] } as const;

  it("the active plan and plan details reach a new device", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    a.account.set({ activePlanId: "p1", planParams: params as never });
    await a.sync();

    const b = newDevice(cloud);
    const result = await b.sync();

    expect(b.account.data.activePlanId).toBe("p1");
    expect(b.account.data.planParams).toEqual(params);
    expect(result.appliedToLocal).toBe(true);
  });

  it("clearing the active plan on one device clears it on the other", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.account.set({ activePlanId: "p1" });
    await a.sync();
    await b.sync();

    a.account.set({ activePlanId: null });
    await a.sync();
    await b.sync();

    expect(b.account.data.activePlanId).toBeNull();
  });

  it("when both devices change a preference, the device acting wins quietly and the other follows", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    const b = newDevice(cloud);
    a.account.set({ activePlanId: "p1" });
    await a.sync();
    await b.sync();

    a.account.set({ activePlanId: "from-a" });
    b.account.set({ activePlanId: "from-b" });
    await a.sync();
    const result = await b.sync();
    await a.sync();

    expect(result.status).toBe("success");
    expect(result.conflicts).toEqual([]);
    expect(cloud.account.data.activePlanId).toBe("from-b");
    expect(a.account.data.activePlanId).toBe("from-b");
  });

  it("a settings-only change takes no restore point", async () => {
    const cloud = newCloud();
    const a = newDevice(cloud);
    await a.sync();
    a.settings.restorePoints = [];
    a.account.set({ activePlanId: "p9" });

    await a.sync();

    expect(a.settings.restorePoints).toHaveLength(0);
  });
});
