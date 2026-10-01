import { describe, expect, it } from "vitest";
import { DayData } from "../../types";
import { dayContentHash, hashString, stableSerialize } from "./contentHash";
import { reconcileDeletions } from "./deletionReconciliation";

function day(date: string, notes = ""): DayData {
  return {
    date,
    sessionType: "gym",
    warmup: [],
    main: [{ id: `${date}-0`, text: "Squat", target: "3x8", done: false }],
    warmupNotes: "",
    mainNotes: notes,
    warmupTimerMs: 0,
    mainTimerMs: 0,
    weight: "",
    checkNotes: "",
  };
}

describe("contentHash", () => {
  it("is independent of key order and sensitive to content", () => {
    expect(stableSerialize({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(stableSerialize({ a: [2, { c: 3, d: 4 }], b: 1 }));
    expect(dayContentHash(day("2026-10-01", "a"))).toBe(dayContentHash(day("2026-10-01", "a")));
    expect(dayContentHash(day("2026-10-01", "a"))).not.toBe(dayContentHash(day("2026-10-01", "b")));
    expect(hashString("x")).not.toBe(hashString("y"));
  });
});

describe("reconcileDeletions", () => {
  const d1 = "2026-10-01";
  const d2 = "2026-10-02";

  it("propagates a local deletion when the cloud copy is unchanged", () => {
    const original = day(d1, "same");
    const result = reconcileDeletions({}, { [d1]: dayContentHash(original) }, { [d1]: original }, {});
    expect(result.deleteInCloud).toEqual({ [d1]: dayContentHash(original) });
    expect(result.cloud).toEqual({});
  });

  it("keeps the cloud copy when it was edited after the local deletion", () => {
    const deletedVersion = day(d1, "old");
    const edited = day(d1, "edited elsewhere");
    const result = reconcileDeletions({}, { [d1]: dayContentHash(deletedVersion) }, { [d1]: edited }, {});
    expect(result.deleteInCloud).toEqual({});
    expect(result.cloud).toEqual({ [d1]: edited });
  });

  it("propagates a cloud deletion when the local copy is unchanged", () => {
    const original = day(d1, "same");
    const result = reconcileDeletions({ [d1]: original }, {}, {}, { [d1]: dayContentHash(original) });
    expect(result.deleteLocally).toEqual([d1]);
    expect(result.local).toEqual({});
  });

  it("keeps a local copy that was edited after the cloud deletion (edit wins)", () => {
    const edited = day(d1, "edited here");
    const result = reconcileDeletions({ [d1]: edited }, {}, {}, { [d1]: dayContentHash(day(d1, "old")) });
    expect(result.deleteLocally).toEqual([]);
    expect(result.local).toEqual({ [d1]: edited });
  });

  it("does nothing when both sides already agree the day is gone", () => {
    const h = dayContentHash(day(d1));
    const result = reconcileDeletions({}, { [d1]: h }, {}, { [d1]: h });
    expect(result.deleteInCloud).toEqual({});
    expect(result.deleteLocally).toEqual([]);
  });

  it("ignores a stale local tombstone when the day was re-created locally", () => {
    const recreated = day(d1, "again");
    const result = reconcileDeletions({ [d1]: recreated }, { [d1]: dayContentHash(day(d1, "old")) }, { [d1]: day(d1, "old") }, {});
    expect(result.deleteInCloud).toEqual({});
    expect(result.cloud[d1]).toEqual(day(d1, "old"));
  });

  it("leaves unrelated days untouched and does not mutate its inputs", () => {
    const local = { [d2]: day(d2) };
    const cloud = { [d1]: day(d1), [d2]: day(d2) };
    const snapshotBefore = JSON.stringify({ local, cloud });
    const result = reconcileDeletions(local, { [d1]: dayContentHash(day(d1)) }, cloud, {});
    expect(Object.keys(result.cloud)).toEqual([d2]);
    expect(Object.keys(result.local)).toEqual([d2]);
    expect(JSON.stringify({ local, cloud })).toBe(snapshotBefore);
  });
});
