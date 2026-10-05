import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DayData } from "../types";
import { dayContentHash, hashString, stableSerialize } from "../application/sync/contentHash";
import { reconcileDeletions } from "../application/sync/deletionReconciliation";
import { historyCutoff } from "../application/sync/historyWindow";
import {
  agreedBase,
  agreedDaysBase,
  baseAfterPartialWrite,
  baseDaysFrom,
  Collection,
  collectionHashes,
  entityHash,
  mergeCollection,
  mergeWorkoutDays,
} from "../application/sync/syncMerge";
import { ConflictResolution } from "../application/sync/syncTypes";

/**
 * Golden scenarios for the sync merge, shared with the Flutter client (mobile/test/contract). The Dart port
 * must give the same answer for every case here, or two devices on different clients would disagree about
 * what is a conflict and what is a deletion. Regenerate after an intentional change with:
 *   UPDATE_CONTRACT=1 npx vitest run contract
 */
const FIXTURE = resolve(process.cwd(), "contract/syncMerge.fixtures.json");

const day = (notes: string): DayData => ({
  date: "2026-10-01", sessionType: "push", warmup: [], main: [{ id: "m1", text: "Bench", done: false }],
  warmupNotes: "", mainNotes: notes, warmupTimerMs: 0, mainTimerMs: 0, weight: "", checkNotes: "",
});
const DAYS: Record<string, DayData | undefined> = { none: undefined, A: day("A"), B: day("B") };
const ITEMS: Record<string, unknown> = { A: { v: "A" }, B: { v: "B" } };
const RESOLUTIONS: Array<ConflictResolution | undefined> = [undefined, "keepLocal", "keepCloud"];

const dayHashOf = (name: string): string | undefined => (DAYS[name] ? dayContentHash(DAYS[name]!) : undefined);
const itemHashOf = (name: string): string | undefined => (name in ITEMS ? entityHash(ITEMS[name]) : undefined);
const withDay = (name: string): Record<string, DayData> => (DAYS[name] ? { "2026-10-01": DAYS[name]! } : {});

function workoutMergeCases() {
  const cases = [];
  for (const local of ["none", "A", "B"]) {
    for (const cloud of ["none", "A", "B"]) {
      for (const base of ["unset", "A", "B", "C"]) {
        for (const resolution of RESOLUTIONS) {
          const baseHash = base === "unset" ? undefined : base === "C" ? hashString("other") : dayHashOf(base);
          const input = {
            local: withDay(local), cloud: withDay(cloud),
            baseDays: baseHash === undefined ? {} : { "2026-10-01": baseHash },
            resolution: resolution ?? null,
          };
          cases.push({ input, expected: mergeWorkoutDays(input.local, input.cloud, input.baseDays, resolution) });
        }
      }
    }
  }
  // Several dates at once, mixed outcomes.
  const multi = {
    local: { "2026-10-01": day("A"), "2026-10-02": day("A"), "2026-10-03": day("B") },
    cloud: { "2026-10-01": day("B"), "2026-10-02": day("A"), "2026-10-04": day("A") },
    baseDays: { "2026-10-01": dayContentHash(day("A")), "2026-10-02": dayContentHash(day("A")) },
    resolution: null,
  };
  cases.push({ input: multi, expected: mergeWorkoutDays(multi.local, multi.cloud, multi.baseDays) });
  return cases;
}

const collectionOf = (name: string): Collection<unknown> =>
  name in ITEMS ? { keys: ["k"], items: { k: ITEMS[name] } } : { keys: [], items: {} };

function collectionMergeCases() {
  const cases = [];
  for (const local of ["none", "A", "B"]) {
    for (const cloud of ["none", "A", "B"]) {
      for (const base of ["unset", "A", "B", "C"]) {
        for (const resolution of RESOLUTIONS) {
          for (const localWinsConflicts of [false, true]) {
            const baseHash = base === "unset" ? undefined : base === "C" ? hashString("other") : itemHashOf(base);
            const input = {
              local: collectionOf(local), cloud: collectionOf(cloud),
              base: baseHash === undefined ? {} : { k: baseHash },
              options: { resolution: resolution ?? null, localWinsConflicts },
            };
            cases.push({
              input,
              expected: mergeCollection(input.local, input.cloud, input.base, { resolution, localWinsConflicts }),
            });
          }
        }
      }
    }
  }
  // Ordering: local order first, then cloud-only keys in cloud order; deleted-on-cloud keys dropped.
  const ordered = {
    local: { keys: ["c", "a", "b"], items: { a: { v: 1 }, b: { v: 2 }, c: { v: 3 } } },
    cloud: { keys: ["d", "a", "e", "c"], items: { a: { v: 1 }, c: { v: 3 }, d: { v: 4 }, e: { v: 5 } } },
    base: { a: entityHash({ v: 1 }), b: entityHash({ v: 2 }), c: entityHash({ v: 3 }) },
    options: { resolution: null, localWinsConflicts: false },
  };
  cases.push({ input: ordered, expected: mergeCollection(ordered.local, ordered.cloud, ordered.base) });
  return cases;
}

function deletionCases() {
  const cases = [];
  const tombstone = (name: string) => (name === "none" ? {} : { "2026-10-01": dayHashOf(name)! });
  for (const local of ["none", "A", "B"]) {
    for (const cloud of ["none", "A", "B"]) {
      for (const localDeleted of ["none", "A", "B"]) {
        for (const cloudDeleted of ["none", "A", "B"]) {
          const input = {
            localData: withDay(local), localDeleted: tombstone(localDeleted),
            cloudData: withDay(cloud), cloudDeleted: tombstone(cloudDeleted),
          };
          cases.push({
            input,
            expected: reconcileDeletions(input.localData, input.localDeleted, input.cloudData, input.cloudDeleted),
          });
        }
      }
    }
  }
  return cases;
}

function baseCases() {
  const h = (v: string) => entityHash({ v });
  const merged: Collection<unknown> = {
    keys: ["a", "b", "c", "d"], items: { a: { v: "a" }, b: { v: "b" }, c: { v: "c" }, d: { v: "d" } },
  };
  const localAfter: Collection<unknown> = {
    keys: ["a", "b", "c"], items: { a: { v: "a" }, b: { v: "changed" }, c: { v: "c" } },
  };
  const previous = { a: "old-a", b: "old-b", z: "old-z" };
  const cloudHashes = { a: h("a"), b: h("b"), c: h("c"), x: h("x") };
  const localHashes = { a: h("a"), b: h("other"), d: h("d"), z: h("z"), x: h("x") };
  return {
    agreedBase: [
      { merged, localAfter, previous, expected: agreedBase(merged, localAfter, previous) },
      { merged, localAfter: null, previous, expected: agreedBase(merged, null, previous) },
    ],
    agreedDaysBase: (() => {
      const d1 = "2026-10-01", d2 = "2026-10-02", d3 = "2026-10-03", d4 = "2026-10-04", d5 = "2026-10-05";
      const dayOn = (date: string, notes: string): DayData => ({ ...day(notes), date });
      // The merge of this sync: every day carries the cloud's newer text.
      const mergedDays = { [d1]: dayOn(d1, "merged"), [d2]: dayOn(d2, "merged"), [d3]: dayOn(d3, "merged"), [d4]: dayOn(d4, "merged"), [d5]: dayOn(d5, "merged") };
      // What this device holds after the writes: d1 as merged; d2 stale (the pull was skipped); d3 edited during the sync;
      // d4 and d5 not held at all.
      const localAfterDays = { [d1]: dayOn(d1, "merged"), [d2]: dayOn(d2, "old"), [d3]: dayOn(d3, "typed during sync") };
      const previousDays = { [d1]: "stale-1", [d2]: baseDaysFrom({ [d2]: dayOn(d2, "old") })[d2], [d5]: "kept-5" };
      return [
        { merged: mergedDays, localAfter: localAfterDays, previous: previousDays, expected: agreedDaysBase(mergedDays, localAfterDays, previousDays) },
        { merged: mergedDays, localAfter: null, previous: previousDays, expected: agreedDaysBase(mergedDays, null, previousDays) },
        { merged: mergedDays, localAfter: localAfterDays, previous: {}, expected: agreedDaysBase(mergedDays, localAfterDays, {}) },
      ];
    })(),
    collectionHashes: [{ collection: merged, expected: collectionHashes(merged) }, { collection: null, expected: collectionHashes(null) }],
    baseDaysFrom: (() => {
      const days = { "2026-10-01": day("A"), "2026-10-02": day("B") };
      return [{ days, expected: baseDaysFrom(days) }];
    })(),
    baseAfterPartialWrite: [
      { previous: { ...previous, c: "old-c", d: "old-d" }, cloudHashes, localHashes,
        expected: baseAfterPartialWrite({ ...previous, c: "old-c", d: "old-d" }, cloudHashes, localHashes) },
      { previous: {}, cloudHashes: {}, localHashes: {}, expected: baseAfterPartialWrite({}, {}, {}) },
    ],
  };
}

function historyCases() {
  const nows = ["2026-10-03T12:00:00", "2026-03-02T00:00:00", "2026-01-03T23:59:59", "2028-03-01T08:00:00"];
  return nows.flatMap((now) =>
    [1, 7, 30].map((days) => ({ now, days, expected: historyCutoff(days, new Date(now)) }))
  );
}

function build() {
  return {
    workoutMerge: workoutMergeCases(),
    collectionMerge: collectionMergeCases(),
    deletions: deletionCases(),
    base: baseCases(),
    historyCutoff: historyCases(),
    // Same value the hash contract covers, kept here so a serialiser regression fails next to the merge.
    entityHashSample: { value: { b: [1, "x"], a: { z: null, y: true } }, serialized: stableSerialize({ b: [1, "x"], a: { z: null, y: true } }) },
  };
}

describe("sync merge contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    // JSON round-trip drops `undefined`, matching what the fixture file stores.
    const built = JSON.parse(JSON.stringify(build()));
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(built)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });
});
