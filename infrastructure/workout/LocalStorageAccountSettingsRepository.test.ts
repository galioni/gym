import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_PLAN_STORAGE_KEY, PLAN_META_STORAGE_KEY, PLAN_PARAMS_STORAGE_KEY } from "../../constants";
import { LocalStorageAccountSettingsRepository } from "./LocalStorageAccountSettingsRepository";

const params = { goal: "strength", experience: "beginner", daysPerWeek: 3, equipment: "full_gym", duration: "45", bodyFocus: ["legs"] };
const meta = { split: "Upper/Lower", schedule: ["Mon", "Thu"], progression: "Add weight weekly" };

describe("LocalStorageAccountSettingsRepository", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads an empty device as all-null settings (never as a missing snapshot)", async () => {
    const snapshot = await new LocalStorageAccountSettingsRepository().readSnapshot();
    expect(snapshot.data).toEqual({ activePlanId: null, planParams: null, planMeta: null });
  });

  it("reads the three separate keys as one snapshot", async () => {
    data.set(ACTIVE_PLAN_STORAGE_KEY, "p1");
    data.set(PLAN_PARAMS_STORAGE_KEY, JSON.stringify(params));
    data.set(PLAN_META_STORAGE_KEY, JSON.stringify(meta));
    const snapshot = await new LocalStorageAccountSettingsRepository().readSnapshot();
    expect(snapshot.data).toEqual({ activePlanId: "p1", planParams: params, planMeta: meta });
  });

  it("writes values to their keys and removes a key when its value is cleared", async () => {
    const repo = new LocalStorageAccountSettingsRepository();
    await repo.writeSnapshot({ version: 1, updatedAt: "x", data: { activePlanId: "p2", planParams: params as never, planMeta: meta as never } });
    expect(data.get(ACTIVE_PLAN_STORAGE_KEY)).toBe("p2");
    expect(JSON.parse(data.get(PLAN_PARAMS_STORAGE_KEY)!)).toEqual(params);

    await repo.writeSnapshot({ version: 1, updatedAt: "x", data: { activePlanId: null, planParams: null, planMeta: null } });
    expect([...data.keys()]).toEqual([]);
  });

  it("ignores corrupt stored JSON instead of failing the whole sync", async () => {
    data.set(PLAN_PARAMS_STORAGE_KEY, "{not json");
    data.set(PLAN_META_STORAGE_KEY, "[1,2,3]");
    const snapshot = await new LocalStorageAccountSettingsRepository().readSnapshot();
    expect(snapshot.data.planParams).toBeNull();
    expect(snapshot.data.planMeta).toBeNull();
  });
});
