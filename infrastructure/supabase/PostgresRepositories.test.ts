import { describe, expect, it } from "vitest";
import { DayData, Plan, Templates } from "../../types";
import { dayContentHash, stableSerialize } from "../../application/sync/contentHash";
import { sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { sanitizeTemplates } from "../../application/workout/templates/templateRules";
import { TEMPLATES } from "../../constants";
import { RowGateway, UserTable } from "./PostgrestRowGateway";
import {
  PostgresAccountSettingsRepository,
  PostgresPlansRepository,
  PostgresTemplateRepository,
  PostgresWorkoutDataRepository,
} from "./PostgresRepositories";

type Row = Record<string, unknown>;

/** In-memory stand-in for the database as seen by one signed-in user. */
class FakeGateway implements RowGateway {
  public tables: Record<UserTable, Map<string, Row>> = {
    workout_days: new Map(),
    templates: new Map(),
    plans: new Map(),
    user_settings: new Map(),
  };
  public upserted: Record<UserTable, number> = { workout_days: 0, templates: 0, plans: 0, user_settings: 0 };
  private clock = 0;

  private static key(table: UserTable, row: Row): string {
    return String(
      table === "workout_days" ? row.day : table === "templates" ? row.session_type : table === "user_settings" ? row.user_id : row.id
    );
  }

  public async requireUserId() { return "user-1"; }

  public async selectAll<T>(table: UserTable): Promise<T[]> {
    return [...this.tables[table].values()].map((row) => ({ ...row })) as T[];
  }

  public async upsertRows(table: UserTable, rows: object[]) {
    for (const row of rows as Row[]) {
      this.tables[table].set(FakeGateway.key(table, row), { ...row, updated_at: new Date(Date.now() + ++this.clock).toISOString() });
      this.upserted[table] += 1;
    }
  }

  public async markDaysDeleted(days: string[]) {
    for (const day of days) {
      const row = this.tables.workout_days.get(day);
      if (row && row.deleted_at === null) row.deleted_at = new Date().toISOString();
    }
  }

  public async deleteMissing(table: "templates" | "plans", keep: string[]) {
    for (const key of [...this.tables[table].keys()]) {
      if (!keep.includes(key)) this.tables[table].delete(key);
    }
  }
}

function day(date: string, notes = "", extra: Partial<DayData> = {}): DayData {
  const raw: DayData = {
    date,
    sessionType: "gym",
    warmup: [{ id: `${date}-w0`, text: "Band pull-aparts", target: "2x15", done: true }],
    main: [{ id: `${date}-m0`, text: "Back squat", target: "3x8", done: false }],
    warmupNotes: "",
    mainNotes: notes,
    warmupTimerMs: 1500,
    mainTimerMs: 90000,
    weight: "79,5",
    checkNotes: "slept well",
    ...extra,
  };
  return sanitizeDayDataRecord({ [date]: raw }, TEMPLATES)[date];
}

const snap = (data: Record<string, DayData>, deletedDays?: Record<string, string>) => ({
  version: 1,
  updatedAt: "2026-10-01T10:00:00.000Z",
  data,
  ...(deletedDays ? { deletedDays } : {}),
});

describe("PostgresWorkoutDataRepository", () => {
  it("returns null when the user has no rows", async () => {
    expect(await new PostgresWorkoutDataRepository(new FakeGateway()).readSnapshot()).toBeNull();
  });

  it("round-trips days exactly, including free-text weight and exercise items", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const days = { "2026-10-01": day("2026-10-01", "first"), "2026-10-02": day("2026-10-02", "second") };

    await repo.writeSnapshot(snap(days));
    const read = await new PostgresWorkoutDataRepository(gateway).readSnapshot();

    expect(stableSerialize(read?.data)).toBe(stableSerialize(days));
    expect(read?.deletedDays).toEqual({});
  });

  it("upserts only the days that changed since the last read", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const days = { "2026-10-01": day("2026-10-01", "a"), "2026-10-02": day("2026-10-02", "b") };
    await repo.writeSnapshot(snap(days));
    gateway.upserted.workout_days = 0;

    await repo.readSnapshot();
    await repo.writeSnapshot(snap(days));
    expect(gateway.upserted.workout_days).toBe(0);

    await repo.writeSnapshot(snap({ ...days, "2026-10-02": day("2026-10-02", "b edited") }));
    expect(gateway.upserted.workout_days).toBe(1);
  });

  it("soft-deletes listed days, reports them as tombstones with the content hash, and an upsert restores them", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const original = day("2026-10-01", "to delete");
    await repo.writeSnapshot(snap({ "2026-10-01": original, "2026-10-02": day("2026-10-02") }));
    await repo.readSnapshot();

    await repo.writeSnapshot(snap({ "2026-10-02": day("2026-10-02") }, { "2026-10-01": dayContentHash(original) }));
    const afterDelete = await repo.readSnapshot();
    expect(Object.keys(afterDelete!.data)).toEqual(["2026-10-02"]);
    expect(afterDelete!.deletedDays).toEqual({ "2026-10-01": dayContentHash(original) });

    await repo.writeSnapshot(snap({ "2026-10-01": day("2026-10-01", "back again"), "2026-10-02": day("2026-10-02") }));
    const restored = await repo.readSnapshot();
    expect(restored!.data["2026-10-01"].mainNotes).toBe("back again");
    expect(restored!.deletedDays).toEqual({});
  });

  it("clamps values to the database limits instead of failing the write", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    await repo.writeSnapshot(
      snap({
        "2026-10-01": day("2026-10-01", "x".repeat(30000), { mainTimerMs: 999_999_999_999, weight: "1".repeat(100) }),
      })
    );
    const row = gateway.tables.workout_days.get("2026-10-01")!;
    expect((row.main_notes as string).length).toBe(20000);
    expect(row.main_timer_ms).toBe(86_400_000);
    expect((row.weight as string).length).toBe(32);
  });

  it("skips corrupt date keys without blocking the rest", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    await repo.writeSnapshot(snap({ "not-a-date": day("not-a-date"), "1999-01-01": day("1999-01-01"), "2026-10-01": day("2026-10-01") }));
    expect([...gateway.tables.workout_days.keys()]).toEqual(["2026-10-01"]);
  });
});

describe("PostgresTemplateRepository", () => {
  const templates: Templates = {
    push: {
      label: "Push day",
      focus: "Chest and triceps",
      source: "user",
      videoUrl: "https://example.com/v",
      warmup: [{ text: "Arm circles", target: "2x10" }],
      main: [{ text: "Bench press", target: "3x8" }],
    },
    legs: { warmup: [], main: [{ text: "Squat", target: "5x5" }] },
  };

  it("round-trips templates in their original order, omitting unset optional fields", async () => {
    const gateway = new FakeGateway();
    const input = sanitizeTemplates(templates);
    await new PostgresTemplateRepository(gateway).writeSnapshot({ version: 1, updatedAt: "x", data: input });
    const read = await new PostgresTemplateRepository(gateway).readSnapshot();

    expect(Object.keys(read!.data)).toEqual(["push", "legs"]);
    expect(stableSerialize(read!.data)).toBe(stableSerialize(input));
    expect(read!.data.legs.label).toBeUndefined();
    expect(read!.data.push.label).toBe("Push day");
    expect(read!.data.push.videoUrl).toBe("https://example.com/v");
  });

  it("removes sessions that are absent from the written snapshot and skips unchanged ones", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresTemplateRepository(gateway);
    const input = sanitizeTemplates(templates);
    await repo.writeSnapshot({ version: 1, updatedAt: "x", data: input });
    await repo.readSnapshot();
    gateway.upserted.templates = 0;

    await repo.writeSnapshot({ version: 1, updatedAt: "x", data: { push: input.push } });

    expect(gateway.upserted.templates).toBe(0);
    expect([...gateway.tables.templates.keys()]).toEqual(["push"]);
  });
});

describe("PostgresPlansRepository", () => {
  const plans: Plan[] = [
    { id: "p1", label: "Strength block", sessionIds: ["push", "legs"], schedule: { 0: "push", 2: "legs" } },
    { id: "p2", label: "Easy week", sessionIds: ["swim"] },
  ];

  it("round-trips plans, including an optional weekly schedule, in order", async () => {
    const gateway = new FakeGateway();
    await new PostgresPlansRepository(gateway).writeSnapshot({ version: 1, updatedAt: "x", data: plans });
    const read = await new PostgresPlansRepository(gateway).readSnapshot();

    expect(stableSerialize(read!.data)).toBe(stableSerialize(plans));
    expect(read!.data[1]).not.toHaveProperty("schedule");
  });

  it("deleting a plan removes its row", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresPlansRepository(gateway);
    await repo.writeSnapshot({ version: 1, updatedAt: "x", data: plans });
    await repo.writeSnapshot({ version: 1, updatedAt: "x", data: [plans[0]] });
    expect([...gateway.tables.plans.keys()]).toEqual(["p1"]);
  });
});

describe("PostgresAccountSettingsRepository", () => {
  const params = { goal: "strength", experience: "beginner", daysPerWeek: 3, equipment: "full_gym", duration: "45", bodyFocus: [] } as never;

  it("returns null when the user has no settings row yet", async () => {
    expect(await new PostgresAccountSettingsRepository(new FakeGateway()).readSnapshot()).toBeNull();
  });

  it("round-trips the active plan, plan params and plan meta", async () => {
    const gateway = new FakeGateway();
    const data = { activePlanId: "p1", planParams: params, planMeta: { split: "PPL", schedule: ["Mon"], progression: "weekly" } };
    await new PostgresAccountSettingsRepository(gateway).writeSnapshot({ version: 1, updatedAt: "x", data });
    const read = await new PostgresAccountSettingsRepository(gateway).readSnapshot();
    expect(read!.data).toEqual(data);
  });

  it("writes only the columns it owns, so other settings (the AI provider) are never overwritten", async () => {
    const gateway = new FakeGateway();
    await new PostgresAccountSettingsRepository(gateway).writeSnapshot({
      version: 1, updatedAt: "x", data: { activePlanId: "p1", planParams: null, planMeta: null },
    });
    expect(Object.keys(gateway.tables.user_settings.get("user-1")!).sort()).toEqual(
      ["active_plan_id", "plan_meta", "plan_params", "updated_at", "user_id"]
    );
    expect(gateway.tables.user_settings.get("user-1")).not.toHaveProperty("ai_provider");
  });

  it("skips the write when nothing changed since the last read", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresAccountSettingsRepository(gateway);
    const data = { activePlanId: "p1", planParams: null, planMeta: null };
    await repo.writeSnapshot({ version: 1, updatedAt: "x", data });
    await repo.readSnapshot();
    gateway.upserted.user_settings = 0;
    await repo.writeSnapshot({ version: 1, updatedAt: "x", data });
    expect(gateway.upserted.user_settings).toBe(0);
  });

  it("drops values over the database size limits instead of failing the write", async () => {
    const gateway = new FakeGateway();
    const huge = { split: "x".repeat(30000), schedule: [], progression: "" };
    await new PostgresAccountSettingsRepository(gateway).writeSnapshot({
      version: 1, updatedAt: "x", data: { activePlanId: "y".repeat(500), planParams: params, planMeta: huge as never },
    });
    const row = gateway.tables.user_settings.get("user-1")!;
    expect(row.plan_meta).toBeNull();
    expect(row.active_plan_id).toBeNull();
    expect(row.plan_params).toEqual(params);
  });
});
