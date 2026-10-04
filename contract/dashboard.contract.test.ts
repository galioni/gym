import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CANCEL_NOTE, WHEN_PRO_ENDS, freePlanSummary } from "../application/plans/planCatalog";
import { formatNextSync } from "../application/sync/syncAllowance";
import { deriveSyncStatus } from "../application/sync/syncStatus";
import {
  createSessionType,
  deleteSessionType,
  getSessionLabel,
  getSessionOptions,
  normalizeSessionTypeId,
  renameSessionType,
} from "../application/workout/sessionTypes/sessionTypeRules";
import {
  clearDayKeepingSession,
  deleteItemInSection,
  resetSectionsFromTemplate,
  toggleItemInSection,
} from "../application/workout/transitions/WorkoutStateTransitions";
import { DayData, TemplateData, Templates } from "../types";
import { createEmptyDay, formatTimer, getProgress } from "../utils";

/**
 * Pure dashboard logic shared with the Flutter client (mobile/test/contract): the wording and ordering a user sees (session
 * labels and option order, sync status text, the next-sync date, timer text, progress) and the day transitions. Both clients
 * must give the same answer, or the same account reads differently on web and on the phone. Regenerate after an intentional
 * change with: UPDATE_CONTRACT=1 npx vitest run contract
 *
 * Math.random is pinned while generating, so the ids the web creates ("i") are the same on both sides.
 */
const FIXTURE = resolve(process.cwd(), "contract/dashboard.fixtures.json");

const row = (id: string, text: string, done = false) => ({ id, text, done });
const dayWith = (done: boolean[]): DayData => ({
  date: "2026-10-01", sessionType: "gym",
  warmup: done.slice(0, 2).map((d, i) => row(`w${i}`, `w${i}`, d)),
  main: done.slice(2).map((d, i) => row(`m${i}`, `m${i}`, d)),
  warmupNotes: "n", mainNotes: "m", warmupTimerMs: 5000, mainTimerMs: 7000, weight: "80", checkNotes: "c",
});

const tpl = (extra: Partial<TemplateData> = {}): TemplateData => ({ warmup: [], main: [{ text: "Move", target: "3x8" }], ...extra });

const TEMPLATE_SETS: Record<string, Templates> = {
  builtInsOnly: { tennis: tpl(), gym: tpl(), swim: tpl(), rest: tpl() },
  builtInsInOddOrder: { rest: tpl(), gym: tpl(), tennis: tpl() },
  customSorting: {
    gym: tpl(), "leg-day": tpl(), "5k-run": tpl(), arms: tpl({ label: "arms" }), "arms-2": tpl({ label: "Arms" }),
    "a-b": tpl({ label: "a b" }), "a-1": tpl({ label: "a-1" }), a1: tpl({ label: "A1" }), ab: tpl({ label: "ab" }),
    eclair: tpl({ label: "éclair" }), eclair2: tpl({ label: "Éclair" }), zeta: tpl({ label: "Zeta" }), alpha: tpl({ label: "alpha" }),
  },
  withMeta: { gym: tpl({ label: "Gym day", focus: "Strength", source: "ai" }), yoga: tpl({ focus: "Calm", source: "user" }) },
  empty: {},
};

const SESSION_IDS = ["tennis", "gym", "swim", "rest", "leg-day", "push_pull", "upper  lower", "-x-", "5k", "yoga flow", "A", ""];
const LABELS = ["Gym", "Leg Day", "  lower  ", "Ünï", "a--b", "5K", "!!!", "x".repeat(40), "Tennis day", "Rest / Recovery"];

function withPinnedRandom<T>(fn: () => T): T {
  const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

const statusInputs = (() => {
  const now = Date.parse("2026-10-03T12:00:00.000Z");
  const synced = (ms: number) => new Date(now - ms).toISOString();
  const base = { isSyncing: false, isOnline: true, conflictCount: 0, lastError: null as string | null, lastSyncedAt: null as string | null, now };
  return [
    { ...base, conflictCount: 1 },
    { ...base, conflictCount: 3, isOnline: false, lastError: "x" },
    { ...base, isOnline: false },
    { ...base, lastError: "Boom" },
    { ...base, lastError: "Boom", isSyncing: true },
    { ...base, isSyncing: true },
    { ...base },
    { ...base, allowance: { nextAvailableAt: null } },
    { ...base, allowance: { nextAvailableAt: "2026-11-03T12:00:00.000Z" } },
    { ...base, lastSyncedAt: synced(10_000) },
    { ...base, lastSyncedAt: synced(59_000) },
    { ...base, lastSyncedAt: synced(60_000) },
    { ...base, lastSyncedAt: synced(59 * 60_000) },
    { ...base, lastSyncedAt: synced(60 * 60_000) },
    { ...base, lastSyncedAt: synced(23 * 3_600_000 + 59 * 60_000) },
    { ...base, lastSyncedAt: synced(24 * 3_600_000) },
    { ...base, lastSyncedAt: synced(5 * 86_400_000) },
    { ...base, lastSyncedAt: synced(5000), allowance: { nextAvailableAt: "2026-09-03T12:00:00.000Z" } },
    { ...base, lastSyncedAt: synced(5000), allowance: { nextAvailableAt: null } },
  ];
})();

// A date in every month of a year, at midday UTC so any time zone from -11h to +11h reads the same calendar day.
const NEXT_SYNC_DATES = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 15, 12)).toISOString());

function build() {
  return withPinnedRandom(() => ({
    formatTimer: [0, 1, 999, 1000, 59_999, 60_000, 61_000, 3_599_000, 3_600_000, 5_999_000, 6_000_000, 86_400_000].map((ms) => ({ ms, text: formatTimer(ms) })),
    progress: [[], [false], [true], [true, false], [true, true, false], [true, false, false, false, false, false, false, false],
      [true, true, true, false, false, false, false, false], [true, true, true, true, true, false, false, false],
      [true, true, true, true, true, true, true, true]].map((done) => ({ done, percent: getProgress(dayWith(done)) })),
    sessionLabels: SESSION_IDS.map((id) => ({ id, label: getSessionLabel(id) })),
    sessionOptions: Object.entries(TEMPLATE_SETS).map(([name, templates]) => ({ name, templates, options: getSessionOptions(templates) })),
    normalizeId: LABELS.map((label) => ({ label, id: normalizeSessionTypeId(label) })),
    createSession: LABELS.map((label) => ({ label, result: createSessionType(TEMPLATE_SETS.withMeta, label) })),
    deleteSession: ["gym", "yoga", "nope"].map((type) => ({ type, result: deleteSessionType(TEMPLATE_SETS.withMeta, type) })),
    renameSession: [["gym", "Gym day"], ["gym", "gym DAY"], ["gym", "  New name "], ["gym", "***"], ["gym", ""], ["yoga", "Gym day"], ["yoga", "Yoga!"], ["yoga", "yoga"]]
      .map(([type, label]) => ({ type, label, result: renameSessionType(TEMPLATE_SETS.withMeta, type, label) })),
    transitions: (() => {
      const templates: Templates = { yoga: { warmup: [{ text: "Cat-cow", target: "1 min", id: "x" }], main: [{ text: "Flow" }] } };
      const day = dayWith([true, false, true, true]);
      return {
        day,
        templates,
        toggle: toggleItemInSection(day, "main", "m0", false),
        toggleMissing: toggleItemInSection(day, "main", "zzz", true),
        deleteItem: deleteItemInSection(day, "warmup", "w1"),
        reset: resetSectionsFromTemplate("2026-10-02", "yoga", day, templates),
        resetUnknown: resetSectionsFromTemplate("2026-10-02", "mystery", day, templates),
        clear: clearDayKeepingSession("2026-10-02", "yoga", templates),
        emptyDefault: createEmptyDay("2026-10-02", "tennis"),
      };
    })(),
    syncStatus: statusInputs.map((input) => ({ input, status: deriveSyncStatus(input) })),
    nextSync: NEXT_SYNC_DATES.map((iso) => ({ iso, text: formatNextSync(iso, "en-GB") })),
    planText: { freeSummary: freePlanSummary(), whenProEnds: WHEN_PRO_ENDS, cancelNote: CANCEL_NOTE },
  }));
}

describe("dashboard contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    const built = JSON.parse(JSON.stringify(build()));
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(built, null, 1)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });
});
