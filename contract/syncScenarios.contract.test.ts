import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SyncService } from "../application/sync/SyncService";
import { SyncAllowanceError } from "../application/sync/syncAllowance";
import { CloudLimitError } from "../application/sync/syncErrors";
import { Tombstones } from "../application/sync/deletionReconciliation";
import { EMPTY_SYNC_BASE, SyncBase } from "../application/sync/syncMerge";
import { PlansSnapshot, SettingsSnapshot, SyncConflict, SyncEntity, SyncNowResult, SyncedSettings } from "../application/sync/syncTypes";
import { AccountSettingsRepository } from "../interfaces/workout/AccountSettingsRepository";
import { PlansRepository } from "../interfaces/workout/PlansRepository";
import { SyncSettings, SyncSettingsRepository } from "../interfaces/sync/SyncSettingsRepository";
import { FakeGateway } from "../infrastructure/supabase/fakeGateway.testSupport";
import {
  PostgresAccountSettingsRepository,
  PostgresPlansRepository,
  PostgresTemplateRepository,
  PostgresWorkoutDataRepository,
} from "../infrastructure/supabase/PostgresRepositories";
import { LocalDays, LocalTemplates, clone } from "../infrastructure/supabase/syncDevice.testSupport";
import { DayData, Plan, TemplateData } from "../types";

/**
 * Golden scenarios for the whole sync engine, shared with the Flutter client (mobile/test/contract). The real
 * SyncService and the real Postgres repositories run against the web test suite's in-memory database; after
 * every step the result and the full state of every device and of the cloud are recorded. The Dart port replays
 * the same steps and must reach the same state, step by step: it is what guarantees that devices on different
 * clients never disagree about a conflict, a deletion, a limit or a restore.
 *
 * Time is fixed: step n runs at BASE + n minutes, on both sides. Regenerate after an intentional change with:
 *   UPDATE_CONTRACT=1 npx vitest run contract
 */
const FIXTURE = resolve(process.cwd(), "contract/syncScenarios.fixtures.json");
const BASE_MS = Date.parse("2026-10-03T12:00:00.000Z");
const STEP_MS = 60_000;

// ---------------------------------------------------------------------------------------------------------------
// Scenario language
// ---------------------------------------------------------------------------------------------------------------

type Step =
  | { op: "days"; device: string; set: Record<string, string | null> }
  | { op: "userDeletes"; device: string; date: string }
  | { op: "templates"; device: string; set: Record<string, string | null> }
  | { op: "plans"; device: string; set: Record<string, string | null> }
  | { op: "settings"; device: string; set: Partial<SyncedSettings> }
  | { op: "sync" | "syncByHand" | "downloadOnly"; device: string; resolution?: Partial<Record<SyncEntity, "keepLocal" | "keepCloud">> }
  | { op: "gateway"; caps?: Record<string, number>; refuse?: null | { allowance: string | null } | { error: string } }
  | { op: "allowance"; device: string; historyDays?: number | null; refuse?: null | { nextAvailableAt: string | null } }
  | { op: "ownership"; device: string; value: "ok" | "otherAccount" }
  | { op: "rollback"; device: string; index: number }
  | { op: "rollbackRaw"; device: string; index: number; corrupt: "workoutData" | "templates" | "plans" }
  | { op: "rollbackUnknown"; device: string }
  | { op: "prune"; device: string };

interface Scenario {
  name: string;
  devices: string[];
  steps: Step[];
}

const mkDay = (date: string, notes: string): DayData => ({
  date,
  sessionType: "yoga",
  warmup: [],
  main: [{ id: `i-${date}`, text: "Move", done: false }],
  warmupNotes: "",
  mainNotes: notes,
  warmupTimerMs: 0,
  mainTimerMs: 0,
  weight: "",
  checkNotes: "",
});
const mkTemplate = (label: string): TemplateData => ({
  label,
  warmup: [],
  main: [{ id: `r-${label}`, text: label, target: "3x8" }],
});
const mkPlan = (id: string, label: string): Plan => ({ id, label, sessionIds: ["a", "b"] });

// ---------------------------------------------------------------------------------------------------------------
// Test doubles the web suite does not have (plans, account settings, restore points)
// ---------------------------------------------------------------------------------------------------------------

class LocalPlans implements PlansRepository {
  public snapshot: PlansSnapshot | null = null;
  public async readSnapshot() { return this.snapshot ? clone(this.snapshot) : null; }
  public async writeSnapshot(next: PlansSnapshot) { this.snapshot = clone(next); }
  public async readPlans() { return this.snapshot?.data ?? []; }
  public async writePlans() {}
  public async readActivePlanId() { return null; }
  public async writeActivePlanId() {}
}

class LocalSettings implements AccountSettingsRepository {
  public data: SyncedSettings = { activePlanId: null, planParams: null, planMeta: null };
  public async readSnapshot(): Promise<SettingsSnapshot> {
    return { version: 1, updatedAt: new Date().toISOString(), data: clone(this.data) };
  }
  public async writeSnapshot(next: SettingsSnapshot) { this.data = clone(next.data); }
}

class SyncSettingsWithRestorePoints implements SyncSettingsRepository {
  public settings: SyncSettings = { mode: "cloud", lastSyncedAt: null, lastError: null };
  public base: SyncBase = EMPTY_SYNC_BASE;
  public points: Array<Record<string, unknown>> = [];
  public async readSettings() { return this.settings; }
  public async writeSettings(settings: SyncSettings) { this.settings = settings; }
  public async readSyncBase() { return this.base; }
  public async writeSyncBase(base: SyncBase) { this.base = clone(base); }
  public async readRestorePoints() { return clone(this.points) as never; }
  public async writeRestorePoints(points: never) { this.points = clone(points as Array<Record<string, unknown>>); }
}

class Device {
  public readonly days = new LocalDays();
  public readonly templates = new LocalTemplates();
  public readonly plans = new LocalPlans();
  public readonly account = new LocalSettings();
  public readonly settings = new SyncSettingsWithRestorePoints();
  public allowance: { historyDays: number | null; refuse: { nextAvailableAt: string | null } | null } = { historyDays: null, refuse: null };
  public ownership: "ok" | "otherAccount" = "ok";
  public readonly service: SyncService;

  public constructor(gateway: FakeGateway) {
    this.service = new SyncService({
      settingsRepository: this.settings,
      allowance: {
        begin: async () => {
          if (this.allowance.refuse) throw new SyncAllowanceError(this.allowance.refuse.nextAvailableAt);
          return { historyDays: this.allowance.historyDays };
        },
      },
      ownership: { check: async () => this.ownership },
      localWorkoutRepository: this.days,
      localTemplateRepository: this.templates,
      localPlansRepository: this.plans,
      localSettingsRepository: this.account,
      cloudWorkoutRepository: new PostgresWorkoutDataRepository(gateway),
      cloudTemplateRepository: new PostgresTemplateRepository(gateway),
      cloudPlansRepository: new PostgresPlansRepository(gateway),
      cloudSettingsRepository: new PostgresAccountSettingsRepository(gateway),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Running a scenario and recording what happened
// ---------------------------------------------------------------------------------------------------------------

const strip = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

function recordResult(result: SyncNowResult, ownership = false) {
  return strip({
    status: result.status,
    reason: result.reason ?? null,
    // The wording of the "other account" refusal names the browser on the web and the device on mobile.
    message: ownership ? null : result.message,
    conflicts: result.conflicts.map((c: SyncConflict) => ({ entity: c.entity, previewPaths: c.previewPaths })),
    appliedToLocal: result.appliedToLocal ?? null,
    nextAvailableAt: result.nextAvailableAt ?? null,
  });
}

function recordDevice(device: Device) {
  const points = device.settings.points as Array<{ workoutData: unknown; templates: unknown; plans: unknown }>;
  return strip({
    days: device.days.data,
    tombstones: device.days.tombstones,
    templates: device.templates.snapshot ? device.templates.snapshot.data : null,
    plans: device.plans.snapshot ? device.plans.snapshot.data : null,
    account: device.account.data,
    base: device.settings.base,
    lastError: device.settings.settings.lastError,
    synced: device.settings.settings.lastSyncedAt !== null,
    restorePoints: points.map((p) => ({ workoutData: p.workoutData !== null, templates: p.templates !== null, plans: p.plans !== null })),
  });
}

function recordCloud(gateway: FakeGateway) {
  const table = (name: keyof FakeGateway["tables"]) =>
    Object.fromEntries(
      [...gateway.tables[name].entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, row]) => {
        const { updated_at: _u, deleted_at, ...rest } = row as Record<string, unknown>;
        void _u;
        return [key, deleted_at === undefined ? rest : { ...rest, deleted: deleted_at !== null }];
      })
    );
  return strip({
    workout_days: table("workout_days"),
    templates: table("templates"),
    plans: table("plans"),
    user_settings: table("user_settings"),
    upserted: gateway.upserted,
  });
}

async function runScenario(scenario: Scenario) {
  const gateway = new FakeGateway();
  const devices = Object.fromEntries(scenario.devices.map((name) => [name, new Device(gateway)]));
  const records: unknown[] = [];

  for (const [index, step] of scenario.steps.entries()) {
    vi.setSystemTime(BASE_MS + (index + 1) * STEP_MS);
    let result: unknown = null;
    const device = "device" in step ? devices[step.device] : null;

    switch (step.op) {
      case "days":
        for (const [date, notes] of Object.entries(step.set)) {
          if (notes === null) delete device!.days.data[date];
          else device!.days.data[date] = mkDay(date, notes);
        }
        break;
      case "userDeletes":
        device!.days.userDeletes(step.date);
        break;
      case "templates": {
        const next = { ...device!.templates.data };
        for (const [key, label] of Object.entries(step.set)) {
          if (label === null) delete next[key];
          else next[key] = mkTemplate(label);
        }
        device!.templates.set(next);
        break;
      }
      case "plans": {
        const byId = new Map((device!.plans.snapshot?.data ?? []).map((p) => [p.id, p]));
        for (const [id, label] of Object.entries(step.set)) {
          if (label === null) byId.delete(id);
          else byId.set(id, mkPlan(id, label));
        }
        device!.plans.snapshot = { version: 1, updatedAt: new Date().toISOString(), data: [...byId.values()] };
        break;
      }
      case "settings":
        device!.account.data = { ...device!.account.data, ...clone(step.set) };
        break;
      case "sync":
      case "syncByHand":
      case "downloadOnly": {
        const out = await device!.service.syncNow(step.resolution ?? {}, {
          automatic: step.op === "sync" || step.op === "downloadOnly",
          downloadOnly: step.op === "downloadOnly",
        });
        result = recordResult(out, device!.ownership === "otherAccount");
        break;
      }
      case "gateway":
        if (step.caps) gateway.caps = step.caps as never;
        if (step.refuse !== undefined) {
          gateway.refuseWrites = step.refuse === null ? null : "allowance" in step.refuse ? new SyncAllowanceError(step.refuse.allowance) : new Error(step.refuse.error);
        }
        break;
      case "allowance":
        if (step.historyDays !== undefined) device!.allowance.historyDays = step.historyDays;
        if (step.refuse !== undefined) device!.allowance.refuse = step.refuse;
        break;
      case "ownership":
        device!.ownership = step.value;
        break;
      case "rollback":
        result = recordResult(await device!.service.rollbackToRestorePoint(String(device!.settings.points[step.index].id)));
        break;
      case "rollbackRaw": {
        (device!.settings.points[step.index] as Record<string, unknown>)[step.corrupt] = { version: "x" };
        result = recordResult(await device!.service.rollbackToRestorePoint(String(device!.settings.points[step.index].id)));
        break;
      }
      case "rollbackUnknown":
        result = recordResult(await device!.service.rollbackToRestorePoint("no-such-id"));
        break;
      case "prune":
        await device!.service.pruneRestorePoints();
        break;
    }
    records.push({ result, devices: Object.fromEntries(Object.entries(devices).map(([n, d]) => [n, recordDevice(d)])), cloud: recordCloud(gateway) });
  }
  return records;
}

// ---------------------------------------------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------------------------------------------

const D1 = "2026-10-01", D2 = "2026-10-02", D3 = "2026-10-03", OLD = "2026-09-01";

const scenarios: Scenario[] = [
  {
    name: "first device uploads everything, second device downloads it",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1", [D2]: "a2" } },
      { op: "templates", device: "A", set: { push: "Push", pull: "Pull" } },
      { op: "plans", device: "A", set: { p1: "Plan one" } },
      { op: "settings", device: "A", set: { activePlanId: "p1", planParams: { goal: "strength" } as never, planMeta: { split: "PPL" } as never } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "manual first sync takes a restore point and reports nothing to do on the second",
    devices: ["A"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1" } },
      { op: "templates", device: "A", set: { push: "Push" } },
      { op: "syncByHand", device: "A" },
      { op: "syncByHand", device: "A" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "edits to different days on two devices merge without a conflict",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1", [D2]: "a2" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "days", device: "A", set: { [D1]: "a1 edited" } },
      { op: "days", device: "B", set: { [D2]: "a2 edited", [D3]: "new on b" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "an edit on one device and nothing on the other is taken, in both directions",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1", [D2]: "w1" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "days", device: "A", set: { [D1]: "v2" } },
      { op: "days", device: "B", set: { [D2]: "w2" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "the same day edited on both devices is a conflict; nothing is written until it is resolved (keep local)",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "days", device: "A", set: { [D1]: "from A" } },
      { op: "days", device: "B", set: { [D1]: "from B" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "B", resolution: { workoutData: "keepLocal" } },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "the same conflict resolved by keeping the cloud",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "days", device: "A", set: { [D1]: "from A" } },
      { op: "days", device: "B", set: { [D1]: "from B" } },
      { op: "sync", device: "A" },
      { op: "syncByHand", device: "B", resolution: { workoutData: "keepCloud" } },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "two devices that each created the same day independently conflict (no common ancestor)",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "mine" } },
      { op: "days", device: "B", set: { [D1]: "yours" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "a day deleted on one device is deleted on the other",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "keep", [D2]: "drop" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "userDeletes", device: "A", date: D2 },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "an edit made elsewhere after a delete beats the delete",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "userDeletes", device: "A", date: D1 },
      { op: "days", device: "B", set: { [D1]: "v1 but edited" } },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "a day deleted and re-created with the same content on the other device",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "same" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "userDeletes", device: "A", date: D1 },
      { op: "days", device: "A", set: { [D1]: "same again" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "templates: independent additions merge; a rename conflict is raised and resolved",
    devices: ["A", "B"],
    steps: [
      { op: "templates", device: "A", set: { push: "Push" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "templates", device: "A", set: { legs: "Legs" } },
      { op: "templates", device: "B", set: { core: "Core" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
      { op: "templates", device: "A", set: { push: "Push A" } },
      { op: "templates", device: "B", set: { push: "Push B" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "B", resolution: { templates: "keepCloud" } },
    ],
  },
  {
    name: "templates: a deletion propagates, but an edit made elsewhere since beats it",
    devices: ["A", "B"],
    steps: [
      { op: "templates", device: "A", set: { push: "Push", pull: "Pull", legs: "Legs" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "templates", device: "A", set: { push: null, legs: null } },
      { op: "templates", device: "B", set: { legs: "Legs edited" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "plans: a clash names the plan; deletion and additions merge",
    devices: ["A", "B"],
    steps: [
      { op: "plans", device: "A", set: { p1: "Cut", p2: "Bulk" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "plans", device: "A", set: { p1: "Cut A", p2: null, p3: "Maintain" } },
      { op: "plans", device: "B", set: { p1: "Cut B" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "B", resolution: { plans: "keepLocal" } },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "account settings are quiet: the device acting wins, and clearing a field propagates",
    devices: ["A", "B"],
    steps: [
      { op: "settings", device: "A", set: { activePlanId: "p1", planParams: { goal: "muscle" } as never } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "settings", device: "A", set: { activePlanId: "p2" } },
      { op: "settings", device: "B", set: { activePlanId: "p3" } },
      { op: "sync", device: "B" },
      { op: "sync", device: "A" },
      { op: "settings", device: "A", set: { planParams: null } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "a conflict in one entity blocks the whole sync; resolving all of them completes it",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1" } },
      { op: "templates", device: "A", set: { push: "Push" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "days", device: "A", set: { [D1]: "A day" } },
      { op: "templates", device: "A", set: { push: "A push" } },
      { op: "days", device: "B", set: { [D1]: "B day" } },
      { op: "templates", device: "B", set: { push: "B push" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "sync", device: "B", resolution: { workoutData: "keepLocal" } },
      { op: "sync", device: "B", resolution: { workoutData: "keepLocal", templates: "keepCloud" } },
    ],
  },
  {
    name: "a Free account at its template limit: stores what fits, keeps the rest, then finishes after an upgrade",
    devices: ["A"],
    steps: [
      { op: "gateway", caps: { templates: 5 } },
      { op: "templates", device: "A", set: { t1: "One", t2: "Two", t3: "Three", t4: "Four", t5: "Five", t6: "Six", t7: "Seven" } },
      { op: "sync", device: "A" },
      { op: "templates", device: "A", set: { t1: "One edited" } },
      { op: "sync", device: "A" },
      { op: "templates", device: "A", set: { t5: null } },
      { op: "sync", device: "A" },
      { op: "gateway", caps: { templates: 200 } },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "a day limit: new days beyond it are held back, deletions free room in the same sync",
    devices: ["A", "B"],
    steps: [
      { op: "gateway", caps: { workout_days: 3 } },
      { op: "days", device: "A", set: { [D1]: "a", [D2]: "b", [D3]: "c", "2026-10-04": "d", "2026-10-05": "e" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "userDeletes", device: "A", date: D1 },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "a limit does not stop days from other devices reaching this one",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "gateway", caps: { workout_days: 1 } },
      { op: "days", device: "B", set: { [D2]: "over the limit" } },
      { op: "days", device: "A", set: { [D1]: "a1 edited" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "an account that has used its sync is refused before anything is read or written, and no error is recorded",
    devices: ["A"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1" } },
      { op: "allowance", device: "A", refuse: { nextAvailableAt: "2026-11-03T00:00:00.000Z" } },
      { op: "sync", device: "A" },
      { op: "syncByHand", device: "A" },
      { op: "allowance", device: "A", refuse: null },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "a refusal in the middle of a sync (database says the window closed) is reported as the allowance",
    devices: ["A"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1" } },
      { op: "gateway", refuse: { allowance: "2026-11-03T00:00:00.000Z" } },
      { op: "sync", device: "A" },
      { op: "gateway", refuse: null },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "the Free plan uploads only its history window; older days stay on the device",
    devices: ["A", "B"],
    steps: [
      { op: "allowance", device: "A", historyDays: 7 },
      { op: "days", device: "A", set: { [OLD]: "old", "2026-09-30": "edge-out", "2026-09-27": "edge-in", [D2]: "recent", [D3]: "today" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "userDeletes", device: "A", date: OLD },
      { op: "userDeletes", device: "A", date: D2 },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "a download-only sync brings data here, sends nothing, and keeps pending deletions",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1", [D2]: "a2" } },
      { op: "templates", device: "A", set: { push: "Push" } },
      { op: "sync", device: "A" },
      { op: "days", device: "B", set: { [D3]: "b only" } },
      { op: "templates", device: "B", set: { legs: "Legs" } },
      { op: "downloadOnly", device: "B" },
      { op: "sync", device: "A" },
      { op: "userDeletes", device: "A", date: D1 },
      { op: "downloadOnly", device: "A" },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
    ],
  },
  {
    name: "a database failure is recorded as the last error and cleared by the next good sync",
    devices: ["A"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "a1" } },
      { op: "gateway", refuse: { error: "connection reset" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "A" },
      { op: "gateway", refuse: null },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "another account's data on this device refuses the sync before anything is read",
    devices: ["A"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "someone else's" } },
      { op: "ownership", device: "A", value: "otherAccount" },
      { op: "sync", device: "A" },
      { op: "ownership", device: "A", value: "ok" },
      { op: "sync", device: "A" },
    ],
  },
  {
    name: "restore points: manual syncs take one, automatic only when there is work, ten are kept, rollback and prune",
    devices: ["A", "B"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1" } },
      { op: "templates", device: "A", set: { push: "Push" } },
      { op: "plans", device: "A", set: { p1: "Plan" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "A" },
      { op: "sync", device: "B" },
      { op: "days", device: "B", set: { [D1]: "v2" } },
      { op: "syncByHand", device: "B" },
      { op: "days", device: "A", set: { [D2]: "extra" } },
      { op: "sync", device: "A" },
      { op: "sync", device: "A" },
      { op: "syncByHand", device: "A" },
      { op: "rollback", device: "A", index: 2 },
      { op: "prune", device: "A" },
      { op: "rollbackUnknown", device: "A" },
      { op: "syncByHand", device: "B" },
    ],
  },
  {
    name: "a corrupted restore point is reported, not applied",
    devices: ["A"],
    steps: [
      { op: "days", device: "A", set: { [D1]: "v1" } },
      { op: "templates", device: "A", set: { push: "Push" } },
      { op: "plans", device: "A", set: { p1: "Plan" } },
      { op: "syncByHand", device: "A" },
      { op: "days", device: "A", set: { [D1]: "v2" } },
      { op: "rollbackRaw", device: "A", index: 0, corrupt: "workoutData" },
      { op: "rollbackRaw", device: "A", index: 0, corrupt: "templates" },
      { op: "rollbackRaw", device: "A", index: 0, corrupt: "plans" },
    ],
  },
  {
    name: "ten restore points are kept, newest first",
    devices: ["A"],
    steps: [
      ...Array.from({ length: 12 }, (_, i) => [
        { op: "days", device: "A", set: { [D1]: `v${i}` } } as Step,
        { op: "syncByHand", device: "A" } as Step,
      ]).flat(),
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------

describe("sync scenarios contract", () => {
  beforeAll(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterAll(() => vi.useRealTimers());

  it("matches the golden fixture the Flutter client replays", async () => {
    const built = [];
    for (const scenario of scenarios) {
      built.push({ ...scenario, expected: await runScenario(scenario) });
    }
    const fixture = JSON.parse(JSON.stringify({ baseMs: BASE_MS, stepMs: STEP_MS, scenarios: built }));
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(fixture)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(fixture);
  });

  it("is deterministic: running every scenario twice gives identical records", async () => {
    for (const scenario of scenarios) {
      const first = JSON.stringify(await runScenario(scenario));
      const second = JSON.stringify(await runScenario(scenario));
      expect(second, scenario.name).toBe(first);
    }
  });

  it("never throws out of the service: every sync step yields a result", async () => {
    for (const scenario of scenarios) {
      for (const record of (await runScenario(scenario)) as Array<{ result: { status?: string } | null }>) {
        if (record.result) expect(["success", "error", "conflict", "idle"]).toContain(record.result.status);
      }
    }
  });
});

void CloudLimitError;
void ({} as Tombstones);
