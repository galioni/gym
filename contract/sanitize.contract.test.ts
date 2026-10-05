import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TEMPLATES } from "../constants";
import { sanitizeDayData } from "../application/workout/data/dayDataRules";
import { sanitizeTemplates } from "../application/workout/templates/templateRules";
import { dayContentHash, stableSerialize } from "../application/sync/contentHash";
import { entityHash } from "../application/sync/syncMerge";
import {
  migrateRawPlansSnapshot,
  migrateRawTemplateSnapshot,
  migrateRawWorkoutSnapshot,
} from "../application/sync/migrations/snapshotMigrations";

/**
 * Golden cases for the sanitisers and snapshot migrations, shared with the Flutter client
 * (mobile/test/contract). Both clients normalise what they read the same way, or the same stored day would hash
 * differently on each and look like a conflict. Regenerate after an intentional change with:
 *   UPDATE_CONTRACT=1 npx vitest run contract
 *
 * Generated values are masked so the fixture is deterministic:
 *   - ids that look like generateId() output (/^[0-9a-z]{1,7}$/) become "<gen>"; ids in these inputs are chosen
 *     (e.g. "ID-1", "2026-10-01-0") so they can never be confused with a generated one;
 *   - an `updatedAt` that was not supplied becomes "<now>".
 */
const FIXTURE = resolve(process.cwd(), "contract/sanitize.fixtures.json");

const maskIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(maskIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "id" && typeof v === "string" && /^[0-9a-z]{1,7}$/.test(v) ? "<gen>" : maskIds(v),
      ])
    );
  }
  return value;
};
// What a persisted value looks like: undefined keys dropped, ids masked.
const norm = (value: unknown) => maskIds(JSON.parse(JSON.stringify(value ?? null)));

const item = (extra: Record<string, unknown>) => ({ id: "ID-1", text: "Squat", done: false, ...extra });

const dayInputs: Array<{ name: string; date: string; raw: unknown }> = [
  { name: "null raw falls back to the default session", date: "2026-10-01", raw: null },
  { name: "string raw", date: "2026-10-01", raw: "junk" },
  { name: "empty object", date: "2026-10-01", raw: {} },
  { name: "blank session type", date: "2026-10-01", raw: { sessionType: "   " } },
  { name: "session type is trimmed", date: "2026-10-01", raw: { sessionType: "  gym  " } },
  { name: "custom session keeps empty sections", date: "2026-10-01", raw: { sessionType: "yoga", warmup: [], main: [] } },
  {
    name: "built-in session with empty sections is refilled from defaults",
    date: "2026-10-01",
    raw: { sessionType: "rest", warmup: [], main: [] },
  },
  {
    name: "items: junk dropped, ids and urls repaired, truthy done",
    date: "2026-10-02",
    raw: {
      sessionType: "yoga",
      main: [
        null,
        "x",
        42,
        item({}),
        { text: "No id" },
        { id: "", text: "Empty id" },
        { id: "ID-2", text: "   " },
        { id: "ID-3", text: "Video", videoUrl: "  https://example.com/v  " },
        { id: "ID-4", text: "Blank video", videoUrl: "   " },
        { id: "ID-5", text: "Target kept as empty", target: "" },
        { id: "ID-6", text: "Done 1", done: 1 },
        { id: "ID-7", text: "Done string", done: "yes" },
        { id: "ID-8", text: "Done zero", done: 0 },
        { id: "ID-9", text: "Done empty string", done: "" },
        { id: "ID-10", text: 5 },
      ],
    },
  },
  {
    name: "equipment and description are dropped from day items",
    date: "2026-10-02",
    raw: {
      sessionType: "yoga",
      main: [item({ equipment: "mat", description: "slow", target: "3x10", videoUrl: "https://example.com" })],
    },
  },
  {
    name: "all items blank falls back to the session default",
    date: "2026-10-02",
    raw: { sessionType: "swim", warmup: [{ id: "ID-1", text: " " }], main: "not an array" },
  },
  {
    name: "scalars: negative and wrong-typed values",
    date: "2026-10-03",
    raw: {
      sessionType: "yoga", warmupNotes: 5, mainNotes: "ok", warmupTimerMs: -50, mainTimerMs: "3", weight: 80, checkNotes: null,
    },
  },
  {
    name: "scalars: valid values",
    date: "2026-10-03",
    raw: {
      sessionType: "yoga", warmupNotes: "w", mainNotes: "m", warmupTimerMs: 1234, mainTimerMs: 0, weight: "79,5", checkNotes: "c",
    },
  },
];

const templateInputs: Array<{ name: string; raw: unknown }> = [
  { name: "null", raw: null },
  { name: "empty", raw: {} },
  { name: "blank session name skipped", raw: { "  ": { warmup: [{ text: "x" }], main: [] }, ok: { warmup: [], main: [] } } },
  {
    name: "built-in session with empty sections refills from defaults",
    raw: { gym: { warmup: [], main: [] } },
  },
  {
    name: "custom session: cell trimming, caps and optional fields",
    raw: {
      yoga: {
        source: "user",
        label: `  ${"L".repeat(60)}  `,
        focus: "  flow  ",
        videoUrl: `  https://example.com/${"u".repeat(600)}  `,
        warmup: [
          { id: "ID-1", text: `  ${"T".repeat(100)}  `, target: `  ${"G".repeat(60)}  `, equipment: ` ${"E".repeat(70)} `, description: ` ${"D".repeat(250)} `, videoUrl: "  https://example.com/a  " },
          { text: "Generated id", target: "   ", equipment: "   ", description: "", videoUrl: "" },
          { id: "ID-2", text: "   " },
        ],
        main: [{ id: "ID-3", text: "Pose", target: "1 min" }],
      },
    },
  },
  { name: "bad source and blank label/focus", raw: { yoga: { source: "robot", label: "  ", focus: "   ", warmup: [], main: [] } } },
  { name: "non-object template and non-array sections", raw: { a: "junk", b: { warmup: "x", main: 5 }, c: null } },
];

const migrateInputs = {
  workout: [
    null, [], "x", { "2026-10-01": { sessionType: "yoga", main: [{ id: "ID-1", text: "A" }] } },
    { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", data: { "2026-10-01": { sessionType: "yoga" } } },
    { version: 1, data: {} }, { version: "1", data: {} }, { version: 1 },
  ],
  templates: [
    null, [], { yoga: { warmup: [{ id: "ID-1", text: "A" }], main: [] } },
    { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", templates: { yoga: { warmup: [], main: [] } } },
    { version: 1, templates: {} }, { version: 1 },
  ],
  plans: [
    null, "x", 5,
    [{ id: "plan-1", label: "A", sessionIds: ["x"] }, { id: 1 }, null, { id: "plan-2", label: "B", sessionIds: [1] }],
    { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", plans: [{ id: "plan-1", label: "A", sessionIds: ["x"], schedule: { "0": "x" } }, { id: "plan-3" }] },
    { version: 1, plans: [] }, { version: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
  ],
};

const suppliedUpdatedAt = (raw: unknown): string | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { updatedAt?: unknown }).updatedAt === "string"
    ? (raw as { updatedAt: string }).updatedAt
    : null;

function migrated(fn: (raw: unknown) => { updatedAt: string }, raw: unknown) {
  const result = norm(fn(raw)) as { updatedAt: string };
  // updatedAt falls back to "now" whenever the input does not carry it through (legacy shapes, malformed envelopes).
  if (result.updatedAt !== suppliedUpdatedAt(raw)) result.updatedAt = "<now>";
  return result;
}

/**
 * The web app hashes the sanitised objects themselves, and those carry explicit `undefined` keys (a day item
 * without a target has `target: undefined`), which its serialiser writes as the token `undefined`. Tombstone
 * hashes stored in the cloud contain it, so the Dart client must reproduce it. Math.random is pinned so the ids the
 * sanitisers generate ("i") are the same on both sides.
 */
function hashes() {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
  try {
    return {
      days: dayInputs.map(({ name, date, raw }) => {
        const day = sanitizeDayData(raw, date, TEMPLATES);
        return { name, date, raw, serialized: stableSerialize(day), hash: dayContentHash(day) };
      }),
      templates: templateInputs.map(({ name, raw }) => {
        const sanitized = sanitizeTemplates(raw as never);
        return {
          name,
          raw,
          items: Object.fromEntries(
            Object.entries(sanitized).map(([key, template]) => [key, { serialized: stableSerialize(template), hash: entityHash(template) }])
          ),
        };
      }),
    };
  } finally {
    random.mockRestore();
  }
}

function build() {
  return {
    hashes: hashes(),
    sanitizeDay: dayInputs.map(({ name, date, raw }) => ({
      name, date, raw, expected: norm(sanitizeDayData(raw, date, TEMPLATES)),
    })),
    sanitizeTemplates: templateInputs.map(({ name, raw }) => ({
      name, raw, expected: norm(sanitizeTemplates(raw as never)),
    })),
    migrateWorkout: migrateInputs.workout.map((raw) => ({ raw, expected: migrated(migrateRawWorkoutSnapshot, raw) })),
    migrateTemplates: migrateInputs.templates.map((raw) => ({ raw, expected: migrated(migrateRawTemplateSnapshot, raw) })),
    migratePlans: migrateInputs.plans.map((raw) => ({ raw, expected: migrated(migrateRawPlansSnapshot, raw) })),
  };
}

describe("sanitiser contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    const built = JSON.parse(JSON.stringify(build()));
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(built, null, 1)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });
});
