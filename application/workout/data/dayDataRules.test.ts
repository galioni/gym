import { describe, expect, it } from "vitest";
import { sanitizeDayDataRecord } from "./dayDataRules";
import { TEMPLATES } from "../../../constants";

describe("dayDataRules", () => {
  it("recovers malformed day payload", () => {
    const date = "2026-02-18";
    const output = sanitizeDayDataRecord(
      {
        [date]: {
          sessionType: "gym",
          warmup: "bad",
          main: [{ text: "Leg Press", done: true }],
          warmupTimerMs: -20,
        },
      },
      TEMPLATES
    );

    expect(output[date].sessionType).toBe("gym");
    expect(output[date].warmup.length).toBeGreaterThan(0);
    expect(output[date].main.length).toBeGreaterThan(0);
    expect(output[date].warmupTimerMs).toBe(0);
  });
});

