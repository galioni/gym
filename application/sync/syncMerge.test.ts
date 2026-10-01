import { describe, expect, it } from "vitest";
import { DayData } from "../../types";
import { dayContentHash } from "./contentHash";
import { agreedBase, baseDaysFrom, Collection, entityHash, mergeCollection, mergeWorkoutDays } from "./syncMerge";

function day(date: string, notes = ""): DayData {
  return {
    date, sessionType: "gym", warmup: [], main: [{ id: `${date}-0`, text: "Squat", done: false }],
    warmupNotes: "", mainNotes: notes, warmupTimerMs: 0, mainTimerMs: 0, weight: "", checkNotes: "",
  };
}

const D1 = "2026-10-01";
const D2 = "2026-10-02";

describe("mergeWorkoutDays", () => {
  it("keeps days that exist on only one side", () => {
    const { merged, conflictKeys } = mergeWorkoutDays({ [D1]: day(D1) }, { [D2]: day(D2) }, {});
    expect(Object.keys(merged).sort()).toEqual([D1, D2]);
    expect(conflictKeys).toEqual([]);
  });

  it("an ordinary local edit of an already-synced day is a push, not a conflict", () => {
    const base = { [D1]: dayContentHash(day(D1, "old")) };
    const { merged, conflictKeys } = mergeWorkoutDays({ [D1]: day(D1, "edited here") }, { [D1]: day(D1, "old") }, base);
    expect(conflictKeys).toEqual([]);
    expect(merged[D1].mainNotes).toBe("edited here");
  });

  it("an edit made on another device is a pull, not a conflict", () => {
    const base = { [D1]: dayContentHash(day(D1, "old")) };
    const { merged, conflictKeys } = mergeWorkoutDays({ [D1]: day(D1, "old") }, { [D1]: day(D1, "edited elsewhere") }, base);
    expect(conflictKeys).toEqual([]);
    expect(merged[D1].mainNotes).toBe("edited elsewhere");
  });

  it("flags a conflict only when both sides changed the same day differently", () => {
    const base = { [D1]: dayContentHash(day(D1, "old")) };
    const result = mergeWorkoutDays({ [D1]: day(D1, "mine") }, { [D1]: day(D1, "theirs") }, base);
    expect(result.conflictKeys).toEqual([D1]);
  });

  it("treats a differing day with no base as a conflict (never agreed before)", () => {
    const result = mergeWorkoutDays({ [D1]: day(D1, "mine") }, { [D1]: day(D1, "theirs") }, {});
    expect(result.conflictKeys).toEqual([D1]);
  });

  it("applies keepLocal / keepCloud to conflicts only", () => {
    const local = { [D1]: day(D1, "mine"), [D2]: day(D2, "local only edit") };
    const cloud = { [D1]: day(D1, "theirs"), [D2]: day(D2, "old") };
    const base = { [D2]: dayContentHash(day(D2, "old")) };
    expect(mergeWorkoutDays(local, cloud, base, "keepCloud").merged[D1].mainNotes).toBe("theirs");
    expect(mergeWorkoutDays(local, cloud, base, "keepCloud").merged[D2].mainNotes).toBe("local only edit");
    expect(mergeWorkoutDays(local, cloud, base, "keepLocal").merged[D1].mainNotes).toBe("mine");
  });

  it("identical days never conflict, even without a base", () => {
    expect(mergeWorkoutDays({ [D1]: day(D1, "same") }, { [D1]: day(D1, "same") }, {}).conflictKeys).toEqual([]);
  });
});

describe("baseDaysFrom", () => {
  it("hashes each day", () => {
    expect(baseDaysFrom({ [D1]: day(D1) })).toEqual({ [D1]: dayContentHash(day(D1)) });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Keyed collections (templates by session type, plans by id, settings by field)
// ---------------------------------------------------------------------------------------------------------------
const col = (entries: Array<[string, string]>): Collection<string> => ({
  keys: entries.map(([key]) => key),
  items: Object.fromEntries(entries),
});
const hashes = (entries: Array<[string, string]>) => Object.fromEntries(entries.map(([key, value]) => [key, entityHash(value)]));

describe("mergeCollection", () => {
  it("takes different items edited on each device without any conflict", () => {
    const base = hashes([["push", "v1"], ["legs", "v1"]]);
    const result = mergeCollection(col([["push", "v2 edited here"], ["legs", "v1"]]), col([["push", "v1"], ["legs", "v2 edited there"]]), base);
    expect(result.conflictKeys).toEqual([]);
    expect(result.merged.items).toEqual({ push: "v2 edited here", legs: "v2 edited there" });
  });

  it("flags only the item changed on both sides", () => {
    const base = hashes([["push", "v1"], ["legs", "v1"]]);
    const result = mergeCollection(col([["push", "mine"], ["legs", "v1"]]), col([["push", "theirs"], ["legs", "v2"]]), base);
    expect(result.conflictKeys).toEqual(["push"]);
    expect(result.merged.items.legs).toBe("v2");
  });

  it("treats a differing item with no base as a conflict, and an identical one as agreed", () => {
    const result = mergeCollection(col([["a", "x"], ["b", "same"]]), col([["a", "y"], ["b", "same"]]), {});
    expect(result.conflictKeys).toEqual(["a"]);
  });

  it("resolves conflicts with keepLocal / keepCloud, or silently for preferences", () => {
    const local = col([["a", "mine"]]);
    const cloud = col([["a", "theirs"]]);
    expect(mergeCollection(local, cloud, {}, { resolution: "keepCloud" }).merged.items.a).toBe("theirs");
    expect(mergeCollection(local, cloud, {}, { resolution: "keepLocal" }).merged.items.a).toBe("mine");
    const quiet = mergeCollection(local, cloud, {}, { localWinsConflicts: true });
    expect(quiet.conflictKeys).toEqual([]);
    expect(quiet.merged.items.a).toBe("mine");
  });

  it("adds items that exist on one side only and were never agreed", () => {
    const result = mergeCollection(col([["mine", "1"]]), col([["theirs", "2"]]), {});
    expect(result.merged.keys).toEqual(["mine", "theirs"]);
  });

  it("honours a deletion on the other side when this side did not change the item since", () => {
    const base = hashes([["gone", "v1"], ["kept", "v1"]]);
    const deletedHere = mergeCollection(col([["kept", "v1"]]), col([["gone", "v1"], ["kept", "v1"]]), base);
    expect(deletedHere.merged.keys).toEqual(["kept"]);
    const deletedThere = mergeCollection(col([["gone", "v1"], ["kept", "v1"]]), col([["kept", "v1"]]), base);
    expect(deletedThere.merged.keys).toEqual(["kept"]);
  });

  it("an edit beats a delete in either direction", () => {
    const base = hashes([["x", "v1"]]);
    expect(mergeCollection(col([["x", "edited here"]]), col([]), base).merged.items.x).toBe("edited here");
    expect(mergeCollection(col([]), col([["x", "edited there"]]), base).merged.items.x).toBe("edited there");
  });

  it("keeps this device's order, then cloud-only items in the cloud's order", () => {
    const result = mergeCollection(col([["b", "1"], ["a", "1"]]), col([["z", "1"], ["a", "1"], ["y", "1"]]), {});
    expect(result.merged.keys).toEqual(["b", "a", "z", "y"]);
  });

  it("does not mutate its inputs", () => {
    const local = col([["a", "1"]]);
    const cloud = col([["b", "2"]]);
    const before = JSON.stringify([local, cloud]);
    mergeCollection(local, cloud, {});
    expect(JSON.stringify([local, cloud])).toBe(before);
  });
});

describe("agreedBase", () => {
  it("records only items this device verifiably holds identically", () => {
    const merged = col([["a", "1"], ["b", "2"], ["c", "3"]]);
    const localAfter = col([["a", "1"], ["b", "DIFFERENT"]]); // c was never pulled; b changed mid-sync
    const previous = { b: entityHash("old-b") };
    const base = agreedBase(merged, localAfter, previous);
    expect(base).toEqual({ a: entityHash("1"), b: entityHash("old-b") });
    expect("c" in base).toBe(false);
  });

  it("a skipped pull never turns into a later local deletion", () => {
    // Cloud-final has item x, but local never got it (write skipped). The base must not claim x was agreed.
    const merged = col([["x", "cloud"]]);
    const base = agreedBase(merged, col([]), {});
    expect(base).toEqual({});
    const next = mergeCollection(col([]), col([["x", "cloud"]]), base);
    expect(next.merged.keys).toEqual(["x"]);
  });

  it("drops items that are no longer in the merged result", () => {
    expect(agreedBase(col([["a", "1"]]), col([["a", "1"]]), { a: entityHash("1"), deleted: entityHash("x") })).toEqual({ a: entityHash("1") });
  });
});
