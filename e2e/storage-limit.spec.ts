import { test, expect } from "@playwright/test";
import { buildMockSession, mockUnlimitedSync, SUPABASE_SESSION_KEY } from "./helpers/mockSession";

const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";
const WORKOUT_KEY = "daily-workout-tracker:v2";

const MOCK_SESSION = buildMockSession({ id: "user-e2e-limit", email: "limit-e2e@example.com" });

const LOCAL_WORKOUT = {
  version: 1,
  updatedAt: "2026-06-10T12:00:00.000Z",
  data: {
    "2026-01-01": {
      date: "2026-01-01",
      sessionType: "gym",
      warmup: [],
      main: [{ id: "m1", text: "Squats", target: "3×8", done: true }],
      warmupNotes: "",
      mainNotes: "written before the limit was hit",
      warmupTimerMs: 0,
      mainTimerMs: 0,
      weight: "",
      checkNotes: "",
    },
  },
};

// What PostgREST returns when the database's row-limit trigger fires (HTTP 422, code PT422).
const LIMIT_ERROR = {
  code: "PT422",
  message: "row limit reached for workout_days: at most 5000 per account",
  hint: "Delete older entries to free space.",
  details: null,
};

test.describe("Cloud storage limit", () => {
  test.beforeEach(async ({ page }) => {
    // Any other Supabase call (auth refresh etc.) is unnecessary with the fake session.
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());
    await mockUnlimitedSync(page);

    // Empty cloud, and the database refuses new days.
    await page.route("**placeholder.supabase.co/rest/v1/workout_days*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: [] });
      } else {
        await route.fulfill({ status: 422, json: LIMIT_ERROR });
      }
    });
    for (const table of ["templates", "plans", "user_settings"]) {
      await page.route(`**placeholder.supabase.co/rest/v1/${table}*`, async (route) => {
        await route.fulfill(route.request().method() === "GET" ? { json: [] } : { status: 201, json: [] });
      });
    }

    await page.addInitScript(
      ({ sessionKey, session, onboardingKey, workoutKey, workout }) => {
        localStorage.setItem(sessionKey, JSON.stringify(session));
        localStorage.setItem(onboardingKey, "true");
        localStorage.setItem(workoutKey, JSON.stringify(workout));
      },
      {
        sessionKey: SUPABASE_SESSION_KEY,
        session: MOCK_SESSION,
        onboardingKey: ONBOARDING_KEY,
        workoutKey: WORKOUT_KEY,
        workout: LOCAL_WORKOUT,
      }
    );
  });

  test("tells the user once, in plain language, and keeps their data", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Cloud storage limit reached")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/safe on this device/)).toBeVisible();

    // Nothing was lost locally.
    const stored = await page.evaluate((key) => localStorage.getItem(key), WORKOUT_KEY);
    expect(stored).toContain("written before the limit was hit");

    // Not a repeating nag: later automatic attempts stay quiet.
    await page.waitForTimeout(2_000);
    await expect(page.getByText("Cloud storage limit reached")).toHaveCount(1);
  });

  test("the sync panel in Settings shows why sync is not completing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Cloud storage limit reached")).toBeVisible({ timeout: 15_000 });

    await page.getByTitle("Settings").click();
    await expect(page.getByText("Sync Settings")).toBeVisible({ timeout: 10_000 });
    // The panel explains it (the toast may still be on screen too, so look inside the panel).
    const panel = page.getByRole("heading", { name: "Sync Settings", exact: true }).locator("xpath=ancestor::div[contains(@class,'glass')][1]");
    await expect(panel.getByText(/reached its cloud storage limit for workout days/)).toBeVisible();
    await expect(panel.getByText("Your data is safe on this device", { exact: false }).first()).toBeVisible();
  });
});
