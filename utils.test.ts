import { describe, expect, it } from "vitest";
import {
  createEmptyDay,
  formatTimer,
  fromLocalDateKey,
  generateId,
  getProgress,
  toLocalDateKey,
} from "./utils";
import { TEMPLATES } from "./constants";
import { DayData } from "./types";

describe("generateId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateId()).toBe("string");
    expect(generateId().length).toBeGreaterThan(0);
  });

  it("returns unique values on repeated calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId()));
    expect(ids.size).toBe(50);
  });
});

describe("toLocalDateKey", () => {
  it("formats a date as YYYY-MM-DD using local calendar fields", () => {
    // Use explicit local date construction to avoid UTC drift
    const date = new Date(2026, 0, 5); // Jan 5 2026 local
    expect(toLocalDateKey(date)).toBe("2026-01-05");
  });

  it("pads single-digit month and day", () => {
    expect(toLocalDateKey(new Date(2026, 2, 3))).toBe("2026-03-03");
  });
});

describe("fromLocalDateKey", () => {
  it("parses YYYY-MM-DD to local midnight", () => {
    const date = fromLocalDateKey("2026-04-15");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3); // April = 3
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
  });

  it("round-trips through toLocalDateKey", () => {
    const key = "2026-11-30";
    expect(toLocalDateKey(fromLocalDateKey(key))).toBe(key);
  });

  it("returns a valid Date for malformed input", () => {
    const result = fromLocalDateKey("not-a-date");
    expect(result instanceof Date).toBe(true);
  });
});

describe("formatTimer", () => {
  it("formats zero as 00:00", () => {
    expect(formatTimer(0)).toBe("00:00");
  });

  it("formats 90 seconds as 01:30", () => {
    expect(formatTimer(90_000)).toBe("01:30");
  });

  it("formats 3661 seconds as 61:01", () => {
    expect(formatTimer(3_661_000)).toBe("61:01");
  });

  it("pads single-digit seconds", () => {
    expect(formatTimer(65_000)).toBe("01:05");
  });

  it("truncates sub-second precision", () => {
    expect(formatTimer(59_999)).toBe("00:59");
  });
});

describe("getProgress", () => {
  it("returns 0 when there are no items", () => {
    const day = createEmptyDay("2026-01-01", "rest", TEMPLATES);
    expect(getProgress(day)).toBe(0);
  });

  it("returns 100 when all items are done", () => {
    const day: DayData = {
      ...createEmptyDay("2026-01-01", "rest", TEMPLATES),
      warmup: [{ id: "1", text: "Stretch", done: true }],
      main: [{ id: "2", text: "Run", done: true }],
    };
    expect(getProgress(day)).toBe(100);
  });

  it("returns 0 when no items are done", () => {
    const day: DayData = {
      ...createEmptyDay("2026-01-01", "rest", TEMPLATES),
      warmup: [{ id: "1", text: "Stretch", done: false }],
      main: [{ id: "2", text: "Run", done: false }],
    };
    expect(getProgress(day)).toBe(0);
  });

  it("returns rounded percentage for partial completion", () => {
    const day: DayData = {
      ...createEmptyDay("2026-01-01", "rest", TEMPLATES),
      warmup: [{ id: "1", text: "A", done: true }],
      main: [
        { id: "2", text: "B", done: false },
        { id: "3", text: "C", done: false },
      ],
    };
    // 1 out of 3 = 33.33... → rounds to 33
    expect(getProgress(day)).toBe(33);
  });
});

describe("createEmptyDay", () => {
  it("creates a day with the correct date and session type", () => {
    const day = createEmptyDay("2026-06-01", "gym", TEMPLATES);
    expect(day.date).toBe("2026-06-01");
    expect(day.sessionType).toBe("gym");
  });

  it("populates warmup and main from the template", () => {
    const day = createEmptyDay("2026-06-01", "gym", TEMPLATES);
    expect(day.warmup.length).toBe(TEMPLATES.gym.warmup.length);
    expect(day.main.length).toBe(TEMPLATES.gym.main.length);
  });

  it("assigns unique ids to every item", () => {
    const day = createEmptyDay("2026-06-01", "gym", TEMPLATES);
    const allIds = [...day.warmup, ...day.main].map((item) => item.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("initialises all items as not done", () => {
    const day = createEmptyDay("2026-06-01", "gym", TEMPLATES);
    expect([...day.warmup, ...day.main].every((item) => !item.done)).toBe(true);
  });

  it("uses empty template when session type is unknown", () => {
    const day = createEmptyDay("2026-06-01", "unknown-session", TEMPLATES);
    expect(day.warmup).toEqual([]);
    expect(day.main).toEqual([]);
  });
});
