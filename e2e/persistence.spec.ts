import { test, expect } from "@playwright/test";

const WORKOUT_KEY = "daily-workout-tracker:v2";

const WORKOUT_FIXTURE = {
  version: 1,
  updatedAt: "2026-06-01T10:00:00.000Z",
  data: {
    "2026-06-01": {
      date: "2026-06-01",
      sessionType: "gym",
      warmup: [],
      main: [],
      warmupNotes: "persistence-check",
      mainNotes: "",
      warmupTimerMs: 0,
      mainTimerMs: 0,
      weight: "",
      checkNotes: "",
    },
  },
};

/**
 * Verifies that workout data written to localStorage survives a page reload.
 * This is the critical local-first guarantee: data is never lost on refresh.
 */
test.describe("localStorage persistence", () => {
  test("workout data survives a page reload", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key: WORKOUT_KEY, value: WORKOUT_FIXTURE }
    );

    await page.reload();

    const stored = await page.evaluate((key) => localStorage.getItem(key), WORKOUT_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!) as typeof WORKOUT_FIXTURE;
    expect(parsed.data["2026-06-01"].warmupNotes).toBe("persistence-check");
    expect(parsed.data["2026-06-01"].sessionType).toBe("gym");
  });

  test("multiple entries survive a reload", async ({ page }) => {
    const multiEntry = {
      ...WORKOUT_FIXTURE,
      data: {
        ...WORKOUT_FIXTURE.data,
        "2026-06-02": {
          date: "2026-06-02",
          sessionType: "swim",
          warmup: [],
          main: [],
          warmupNotes: "day-2",
          mainNotes: "",
          warmupTimerMs: 0,
          mainTimerMs: 0,
          weight: "80",
          checkNotes: "",
        },
      },
    };

    await page.goto("/");
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key: WORKOUT_KEY, value: multiEntry }
    );

    await page.reload();

    const stored = await page.evaluate((key) => localStorage.getItem(key), WORKOUT_KEY);
    const parsed = JSON.parse(stored!) as typeof multiEntry;
    expect(Object.keys(parsed.data)).toHaveLength(2);
    expect(parsed.data["2026-06-02"].weight).toBe("80");
  });
});
