import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DayData } from "../types";
import { dayContentHash, hashString, stableSerialize } from "../application/sync/contentHash";

/**
 * Golden fixtures shared with the Flutter client (mobile/test/contract). Both clients must produce the same
 * serialisation and hash for the same day, or a day edited on one will look like a conflict on the other.
 * Regenerate after an intentional change with: UPDATE_CONTRACT=1 npx vitest run contract
 */
const FIXTURE = resolve(process.cwd(), "contract/contentHash.fixtures.json");

const item = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, text, done: false, ...extra });

const days: Record<string, DayData> = {
  empty: {
    date: "2026-10-01", sessionType: "push", warmup: [], main: [], warmupNotes: "", mainNotes: "",
    warmupTimerMs: 0, mainTimerMs: 0, weight: "", checkNotes: "",
  },
  full: {
    date: "2026-10-02", sessionType: "legs",
    warmup: [item("w1", "Leg swings", { target: "2x10", equipment: "none", description: "Controlled", videoUrl: "https://example.com/v" })],
    main: [item("m1", "Squat", { target: "5x5", done: true }), item("m2", "Lunge")],
    warmupNotes: "easy", mainNotes: "PR 100kg", warmupTimerMs: 300000, mainTimerMs: 3_600_000,
    weight: "79,5", checkNotes: "slept well",
  },
  unicode: {
    date: "2026-10-03", sessionType: "pull",
    warmup: [], main: [item("m1", "Péña — 🏋️ \"quoted\" \\ back\nline\ttab\u0001ctl")],
    warmupNotes: "café", mainNotes: "日本語", warmupTimerMs: 1, mainTimerMs: 2, weight: "80", checkNotes: "",
  },
};

const strings = ["", "a", "abc", "Hello, world", "café", "🏋️", "x".repeat(1000)];

function build() {
  return {
    hashString: strings.map((input) => ({ input, hash: hashString(input) })),
    days: Object.entries(days).map(([name, day]) => ({
      name, day, serialized: stableSerialize(day), hash: dayContentHash(day),
    })),
  };
}

describe("content hash contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    const built = build();
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(built, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });
});
