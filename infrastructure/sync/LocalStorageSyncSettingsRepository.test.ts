import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageSyncSettingsRepository, RESTORE_POINTS_BUDGET_CHARS } from "./LocalStorageSyncSettingsRepository";

const point = (id: string, size: number) => ({ id, createdAt: "2026-10-01T00:00:00Z", workoutData: "x".repeat(size), templates: null });

/** A localStorage whose writes the test can make fail, like a browser that has run out of room. */
function stubStorage(failWhen: (value: string) => boolean = () => false) {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWhen(v)) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  });
}

describe("restore points", () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps every point while they fit", async () => {
    const repo = new LocalStorageSyncSettingsRepository();
    await repo.writeRestorePoints([point("3", 100), point("2", 100), point("1", 100)]);
    expect((await repo.readRestorePoints()).map((p) => p.id)).toEqual(["3", "2", "1"]);
  });

  it("drops the oldest points first when they exceed the budget, and always keeps the newest", async () => {
    const repo = new LocalStorageSyncSettingsRepository();
    const big = Math.floor(RESTORE_POINTS_BUDGET_CHARS * 0.45);
    await repo.writeRestorePoints([point("3", big), point("2", big), point("1", big)]);
    expect((await repo.readRestorePoints()).map((p) => p.id)).toEqual(["3", "2"]);

    await repo.writeRestorePoints([point("huge", RESTORE_POINTS_BUDGET_CHARS * 2), point("old", 10)]);
    expect((await repo.readRestorePoints()).map((p) => p.id)).toEqual(["huge"]);
  });

  it("drops older points when the browser itself refuses the write, and fails only if the newest cannot be stored", async () => {
    const repo = new LocalStorageSyncSettingsRepository();
    stubStorage((value) => value.includes('"id":"old"'));
    await repo.writeRestorePoints([point("new", 10), point("old", 10)]);
    expect((await repo.readRestorePoints()).map((p) => p.id)).toEqual(["new"]);

    stubStorage(() => true);
    await expect(repo.writeRestorePoints([point("new", 10)])).rejects.toThrow();
  });
});
