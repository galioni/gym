import { describe, expect, it } from "vitest";
import { DayData, Plan, Templates } from "../../types";
import { dayContentHash, stableSerialize } from "../../application/sync/contentHash";
import { sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { sanitizeTemplates } from "../../application/workout/templates/templateRules";
import { TEMPLATES } from "../../constants";
import { CloudLimitError } from "../../application/sync/syncErrors";
import { FakeGateway } from "./fakeGateway.testSupport";
import {
  PostgresAccountSettingsRepository,
  PostgresPlansRepository,
  PostgresTemplateRepository,
  PostgresWorkoutDataRepository,
} from "./PostgresRepositories";

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

  it("keeps no content for a deleted day, yet the tombstone still matches the original day", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const original = day("2026-10-01", "private note");
    await repo.writeSnapshot(snap({ "2026-10-01": original }));
    await repo.readSnapshot();

    await repo.writeSnapshot(snap({}, { "2026-10-01": dayContentHash(original) }));

    const stored = (await gateway.selectAll<Record<string, unknown>>("workout_days"))[0];
    expect(stored.deleted_at).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain("private note");
    expect(stored.main).toEqual([]);
    // Another device compares its own copy against this hash to decide whether the deletion applies to it.
    const fresh = await new PostgresWorkoutDataRepository(gateway).readSnapshot();
    expect(fresh!.deletedDays).toEqual({ "2026-10-01": dayContentHash(original) });
  });

  it("falls back to hashing the content for a deleted row that has no stored hash", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const original = day("2026-10-01", "legacy");
    await repo.writeSnapshot(snap({ "2026-10-01": original }));
    const [row] = await gateway.selectAll<Record<string, unknown>>("workout_days");
    gateway.tables.workout_days.set("2026-10-01", { ...row, deleted_at: "2026-10-02T00:00:00.000Z" });

    const read = await new PostgresWorkoutDataRepository(gateway).readSnapshot();
    expect(read!.deletedDays).toEqual({ "2026-10-01": dayContentHash(original) });
  });

  it("a restore clears the stored hash", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const original = day("2026-10-01", "x");
    await repo.writeSnapshot(snap({ "2026-10-01": original }));
    await repo.readSnapshot();
    await repo.writeSnapshot(snap({}, { "2026-10-01": dayContentHash(original) }));
    await repo.readSnapshot();

    await repo.writeSnapshot(snap({ "2026-10-01": day("2026-10-01", "back") }));
    const [row] = await gateway.selectAll<Record<string, unknown>>("workout_days");
    expect(row.deleted_at).toBeNull();
    expect(row.deleted_hash).toBeNull();
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

describe("account limits never block edits, deletions or the rows that fit", () => {
  const tpl = (text: string): Templates[string] => ({ warmup: [], main: [{ text, target: "3x8" }] });
  const snapshot = (data: Templates) => ({ version: 1, updatedAt: "x", data: sanitizeTemplates(data) });

  async function cloudWith(keys: string[], cap: number) {
    const gateway = new FakeGateway();
    const seed: Templates = Object.fromEntries(keys.map((key) => [key, tpl(`${key} v1`)]));
    await new PostgresTemplateRepository(gateway).writeSnapshot(snapshot(seed));
    gateway.caps.templates = cap;
    const repo = new PostgresTemplateRepository(gateway);
    await repo.readSnapshot();
    return { gateway, repo };
  }
  const stored = (gateway: FakeGateway) => [...gateway.tables.templates.keys()].sort();

  it("saves edits to existing items even when a new item is over the limit, then reports the limit", async () => {
    const { gateway, repo } = await cloudWith(["a", "b"], 2);

    const write = repo.writeSnapshot(snapshot({ a: tpl("a EDITED"), b: tpl("b v1"), c: tpl("c new") }));

    await expect(write).rejects.toBeInstanceOf(CloudLimitError);
    expect(stored(gateway)).toEqual(["a", "b"]);
    expect(JSON.stringify(gateway.tables.templates.get("a"))).toContain("a EDITED");
  });

  it("lets someone at the limit delete one item and add another in the same sync", async () => {
    const { gateway, repo } = await cloudWith(["a", "b"], 2);

    await repo.writeSnapshot(snapshot({ b: tpl("b v1"), c: tpl("c new") }));

    expect(stored(gateway)).toEqual(["b", "c"]);
  });

  it("stores as many new items as fit instead of none, then reports the limit", async () => {
    const { gateway, repo } = await cloudWith(["a"], 3);

    const write = repo.writeSnapshot(snapshot({ a: tpl("a v1"), b: tpl("b"), c: tpl("c"), d: tpl("d"), e: tpl("e") }));

    await expect(write).rejects.toBeInstanceOf(CloudLimitError);
    expect(stored(gateway)).toEqual(["a", "b", "c"]);
  });

  it("does not hide a failure that is not a limit", async () => {
    const { gateway, repo } = await cloudWith(["a"], 5);
    gateway.upsertRows = async () => {
      throw new Error("connection reset");
    };
    await expect(repo.writeSnapshot(snapshot({ a: tpl("a v1"), b: tpl("b") }))).rejects.toThrow("connection reset");
  });

  it("applies the same order to workout days: deleting a day at the cap makes room for a new one", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    const first = day("2026-10-01", "first");
    const second = day("2026-10-02", "second");
    await repo.writeSnapshot(snap({ "2026-10-01": first, "2026-10-02": second }));
    gateway.caps.workout_days = 2;
    await repo.readSnapshot();

    await repo.writeSnapshot(snap({ "2026-10-02": second, "2026-10-03": day("2026-10-03", "third") }, { "2026-10-01": dayContentHash(first) }));

    const live = [...gateway.tables.workout_days.values()].filter((row) => row.deleted_at == null).map((row) => row.day).sort();
    expect(live).toEqual(["2026-10-02", "2026-10-03"]);
  });

  it("keeps the edits to existing days when a new day is refused at the cap", async () => {
    const gateway = new FakeGateway();
    const repo = new PostgresWorkoutDataRepository(gateway);
    await repo.writeSnapshot(snap({ "2026-10-01": day("2026-10-01", "v1") }));
    gateway.caps.workout_days = 1;
    await repo.readSnapshot();

    const write = repo.writeSnapshot(snap({ "2026-10-01": day("2026-10-01", "v2 edited"), "2026-10-02": day("2026-10-02", "new") }));

    await expect(write).rejects.toBeInstanceOf(CloudLimitError);
    expect(gateway.tables.workout_days.size).toBe(1);
    expect(String(gateway.tables.workout_days.get("2026-10-01")?.main_notes)).toBe("v2 edited");
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
