import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExerciseLibrary } from "../application/workout/exerciseLibrary";
import { validateTemplateRows } from "../application/workout/templates/templateRules";
import { DayData } from "../types";

/**
 * Rules the template editor and the exercise autocomplete follow, shared with the Flutter client (mobile/test/contract): the
 * messages for a bad row, which exercises the autocomplete knows about, and which video links are accepted. Regenerate after an
 * intentional change with: UPDATE_CONTRACT=1 npx vitest run contract
 */
const FIXTURE = resolve(process.cwd(), "contract/editors.fixtures.json");

/** The video-link pattern lives inside the editor component; read it from the source so the two can never drift. */
function youtubePattern(): RegExp {
  const source = readFileSync(resolve(process.cwd(), "features/templates/components/TemplateEditor/TemplateEditor.tsx"), "utf8");
  const match = /const YOUTUBE_URL_RE = (\/.*\/);/.exec(source);
  if (!match) throw new Error("YOUTUBE_URL_RE not found in TemplateEditor.tsx");
  return new Function(`return ${match[1]}`)() as RegExp;
}

const URLS = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "http://youtube.com/watch?v=dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://youtube.com/shorts/abcdefghijk&t=3",
  "https://www.youtube.com/watch?v=short", "https://example.com/watch?v=dQw4w9WgXcQ", "youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/playlist?list=PL1234567890", "ftp://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXc!", "", "  ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ with trailing text", "HTTPS://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
];

const long = (n: number) => "x".repeat(n);
const ROWS: Array<Array<{ text: string; target?: string }>> = [
  [], [{ text: "Squat", target: "3x8" }], [{ text: "" }], [{ text: "   " }], [{ text: "Ok" }, { text: "" }, { text: "Fine", target: "1" }],
  [{ text: long(80) }], [{ text: long(81) }], [{ text: ` ${long(80)} ` }], [{ text: "A", target: long(40) }], [{ text: "A", target: long(41) }],
  [{ text: "", target: long(50) }], [{ text: long(100), target: long(100) }], [{ text: "A", target: ` ${long(40)} ` }],
];

const item = (id: string, text: string, target?: string) => ({ id, text, done: false, ...(target ? { target } : {}) });
const day = (date: string, warmup: ReturnType<typeof item>[], main: ReturnType<typeof item>[]): DayData => ({
  date, sessionType: "gym", warmup, main, warmupNotes: "", mainNotes: "", warmupTimerMs: 0, mainTimerMs: 0, weight: "", checkNotes: "",
});

const HISTORIES: Record<string, Record<string, DayData>> = {
  empty: {},
  dedupe: {
    "2026-10-01": day("2026-10-01", [item("a", "Squat", "3x5")], [item("b", "Bench", "3x8")]),
    "2026-10-03": day("2026-10-03", [], [item("c", "squat ", "5x5"), item("d", "Deadlift")]),
    "2026-10-02": day("2026-10-02", [item("e", "  BENCH  ", "4x6")], []),
  },
  sortingAndBlanks: {
    "2026-10-01": day("2026-10-01", [item("1", "pull-up"), item("2", "Pull Up"), item("3", "  "), item("4", "arm circles")], [item("5", "Zottman curl"), item("6", "Ab wheel"), item("7", "ab roller", "3x10")]),
  },
  targetsKeepFirstSeen: {
    "2026-09-01": day("2026-09-01", [], [item("1", "Row", "old")]),
    "2026-10-01": day("2026-10-01", [], [item("2", "Row")]),
  },
};

function build() {
  const pattern = youtubePattern();
  return {
    youtube: URLS.map((url) => ({ url, valid: pattern.test(url) })),
    rows: ROWS.map((rows) => ({ rows, errors: validateTemplateRows(rows) })),
    library: Object.entries(HISTORIES).map(([name, days]) => ({ name, days, entries: buildExerciseLibrary(days) })),
  };
}

describe("editors contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    const built = JSON.parse(JSON.stringify(build()));
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(built, null, 1)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });
});
