import { describe, expect, it, vi } from "vitest";
import { HistoryLimitedCloudWorkout, historyCutoff } from "./historyWindow";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { DayData } from "../../types";

describe("historyCutoff", () => {
  const now = new Date(2026, 9, 10, 15, 30); // 10 Oct 2026, afternoon

  it("counts today as the first of the days", () => {
    expect(historyCutoff(1, now)).toBe("2026-10-10");
    expect(historyCutoff(7, now)).toBe("2026-10-04");
  });

  it("crosses month and year boundaries", () => {
    expect(historyCutoff(7, new Date(2027, 0, 3))).toBe("2026-12-28");
    expect(historyCutoff(7, new Date(2026, 2, 3))).toBe("2026-02-25");
  });
});

describe("HistoryLimitedCloudWorkout", () => {
  const entry = (date: string) => ({ date }) as unknown as DayData;
  const inner = () => ({
    readAll: vi.fn(async () => ({})),
    readSnapshot: vi.fn(async () => null),
    writeAll: vi.fn(async () => {}),
    writeSnapshot: vi.fn(async () => {}),
  });

  it("drops days and deletions older than the cutoff from every upload", async () => {
    const repo = inner();
    const limited = new HistoryLimitedCloudWorkout(repo as unknown as WorkoutDataRepository, "2026-10-04");

    await limited.writeAll({ "2026-10-03": entry("a"), "2026-10-04": entry("b") });
    await limited.writeSnapshot({
      version: 1,
      data: { "2026-09-01": entry("c"), "2026-10-09": entry("d") },
      deletedDays: { "2026-08-01": "h1", "2026-10-05": "h2" },
    } as never);

    expect(Object.keys((repo.writeAll.mock.calls[0] as unknown as [Record<string, unknown>])[0])).toEqual(["2026-10-04"]);
    const snapshot = (repo.writeSnapshot.mock.calls[0] as unknown as [{ data: object; deletedDays: object }])[0];
    expect(Object.keys(snapshot.data)).toEqual(["2026-10-09"]);
    expect(Object.keys(snapshot.deletedDays)).toEqual(["2026-10-05"]);
  });

  it("reads straight through", async () => {
    const repo = inner();
    const limited = new HistoryLimitedCloudWorkout(repo as unknown as WorkoutDataRepository, "2026-10-04");
    await limited.readAll();
    await limited.readSnapshot();
    expect(repo.readAll).toHaveBeenCalledTimes(1);
    expect(repo.readSnapshot).toHaveBeenCalledTimes(1);
  });
});
