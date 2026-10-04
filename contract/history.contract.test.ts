import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DayData } from "../types";
import { fromLocalDateKey, getProgress, toLocalDateKey } from "../utils";

/**
 * The statistics on the History screen, shared with the Flutter client (mobile/test/contract). They live inside React components,
 * not exported, so their source is read from the component files and run here with "today" pinned: that way the Flutter port is
 * checked against the web app's own code, and cannot drift from it. Regenerate after an intentional change with:
 *   UPDATE_CONTRACT=1 npx vitest run contract
 */
const FIXTURE = resolve(process.cwd(), "contract/history.fixtures.json");
const TODAY = new Date(2026, 9, 3, 12, 0, 0); // Saturday 3 Oct 2026, local time

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Removes the TypeScript the few functions use, so they can run as plain JavaScript. */
function strip(source: string): string {
  return source
    .replace(/\)\s*:\s*(string|number|boolean|number \| null)\s*\{/g, ") {")
    .replace(/(\w+)\s*:\s*(Record<string, DayData>|DayData\[\]|DayData|string \| undefined|string|number|boolean)(?=[,)=])/g, "$1")
    .replace(/\(\s*total\s*,\s*day\s*\)/g, "(total, day)");
}

function load() {
  const page = read("features/history/components/HistoryPage/HistoryPage.tsx");
  const chart = read("features/history/components/WeightChart/WeightChart.tsx");
  const slice = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));
  const pageFns = strip(slice(page, "function hasCompletedItems", "function StatCard"));
  const weightFn = strip(slice(chart, "function parseWeight", "interface WeightEntry"));

  // `new Date()` with no argument is the pinned today; everything else behaves as normal.
  class PinnedDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(TODAY.getTime());
      else super(...(args as [number]));
    }
  }
  const factory = new Function(
    "Date", "fromLocalDateKey", "toLocalDateKey",
    `${pageFns}\n${weightFn}\nreturn { hasCompletedItems, isWorthyDay, getWeekStart, weekLabel, calcStreak, getThisWeekCount, parseSetCount, calcWeeklyVolume, progressBarColor, parseWeight };`
  );
  return factory(PinnedDate, fromLocalDateKey, toLocalDateKey) as {
    hasCompletedItems(day: DayData): boolean;
    isWorthyDay(day: DayData): boolean;
    getWeekStart(key: string): string;
    weekLabel(weekStart: string): string;
    calcStreak(all: Record<string, DayData>): number;
    getThisWeekCount(all: Record<string, DayData>): number;
    parseSetCount(target: string | undefined): number;
    calcWeeklyVolume(days: DayData[]): number;
    progressBarColor(pct: number): string;
    parseWeight(raw: string): number | null;
  };
}

const item = (id: string, text: string, done: boolean, target?: string) => ({ id, text, done, ...(target !== undefined ? { target } : {}) });
const day = (
  date: string,
  opts: { warmup?: ReturnType<typeof item>[]; main?: ReturnType<typeof item>[]; notes?: string; weight?: string; wnotes?: string } = {}
): DayData => ({
  date, sessionType: "gym", warmup: opts.warmup ?? [], main: opts.main ?? [], warmupNotes: opts.wnotes ?? "", mainNotes: opts.notes ?? "",
  warmupTimerMs: 0, mainTimerMs: 0, weight: opts.weight ?? "", checkNotes: "",
});
const done = (date: string, target?: string) => day(date, { main: [item(`i-${date}`, "Lift", true, target)] });

const TARGETS = ["3x8", "3 x 8", "4×10", "4 × 10", "5x5-8", "3 sets of 10", "3 SETS OF 10", "3set of 10", "10", "", undefined, "x8", "3x", "12 x 3 x 2", "  4x6  ", "AMRAP", "3-4 sets of 8"];
const WEIGHTS = ["79.5", "79,5", "80", " 80 kg ", "kg", "", "   ", "0", "-5", "1000", "999.9", "1,000", "7.9.5", "abc", "12e1", ".5", "5."];
const STARTS = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-02", "2026-09-28", "2026-09-27", "2026-09-21", "2026-09-14", "2026-01-01", "2025-12-29", "2024-02-29"];
const PCTS = [0, 1, 49, 50, 51, 99, 100];

const HISTORIES: Record<string, Record<string, DayData>> = {
  empty: {},
  streakThroughToday: {
    "2026-10-03": done("2026-10-03"), "2026-10-02": done("2026-10-02"), "2026-10-01": done("2026-10-01"), "2026-09-29": done("2026-09-29"),
  },
  streakEndsYesterday: { "2026-10-02": done("2026-10-02"), "2026-10-01": done("2026-10-01"), "2026-09-30": done("2026-09-30") },
  todayStartedNotDone: {
    "2026-10-03": day("2026-10-03", { main: [item("a", "Lift", false)] }), "2026-10-02": done("2026-10-02"),
  },
  gapYesterday: { "2026-10-03": done("2026-10-03"), "2026-10-01": done("2026-10-01") },
  longStreakAcrossMonthAndYear: Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => {
      const d = new Date(2026, 9, 3 - i);
      const key = toLocalDateKey(d);
      return [key, done(key)];
    })
  ),
  mixed: {
    "2026-10-05": done("2026-10-05"), // a future day does not count toward "this week"
    "2026-10-03": done("2026-10-03", "3x8"),
    "2026-09-30": day("2026-09-30", { notes: "only notes" }),
    "2026-09-29": day("2026-09-29", { weight: " 80 " }),
    "2026-09-28": day("2026-09-28", { wnotes: "  " }),
    "2026-09-20": day("2026-09-20", { main: [item("x", "Lift", true, "4x10"), item("y", "Curl", true, "3 sets of 12"), item("z", "Row", false, "5x5")] }),
    "2025-12-31": done("2025-12-31", "2x6"),
  },
};

function build() {
  const w = load();
  const entries = Object.entries(HISTORIES);
  return {
    targets: TARGETS.map((target) => ({ target: target ?? null, sets: w.parseSetCount(target) })),
    weights: WEIGHTS.map((raw) => ({ raw, value: w.parseWeight(raw) })),
    weekStarts: STARTS.map((key) => ({ key, weekStart: w.getWeekStart(key), label: w.weekLabel(w.getWeekStart(key)) })),
    // How a row names its day (the component formats it inline), for every weekday and month.
    rowDates: Array.from({ length: 24 }, (_, i) => {
      const d = new Date(2026, 8, 28 + i * 9);
      return {
        key: toLocalDateKey(d),
        row: fromLocalDateKey(toLocalDateKey(d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
        chart: fromLocalDateKey(toLocalDateKey(d)).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      };
    }),
    labels: ["2026-09-28", "2026-09-21", "2026-09-14", "2026-01-05", "2025-12-29"].map((ws) => ({ weekStart: ws, label: w.weekLabel(ws) })),
    colors: PCTS.map((pct) => ({ pct, color: w.progressBarColor(pct) })),
    histories: entries.map(([name, all]) => {
      const days = Object.values(all);
      return {
        name,
        days: all,
        worthy: days.map((d) => ({ date: d.date, completed: w.hasCompletedItems(d), worthy: w.isWorthyDay(d), progress: getProgress(d) })),
        streak: w.calcStreak(all),
        thisWeek: w.getThisWeekCount(all),
        volume: w.calcWeeklyVolume(days),
        total: days.filter(w.hasCompletedItems).length,
      };
    }),
  };
}

describe("history contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    const built = JSON.parse(JSON.stringify(build()));
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify({ today: TODAY.getTime(), ...built }, null, 1)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual({ today: TODAY.getTime(), ...built });
  });
});
