import { test, expect } from "@playwright/test";
import { buildMockSession, mockUnlimitedSync, SUPABASE_SESSION_KEY } from "./helpers/mockSession";

const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";
const WORKOUT_KEY = "daily-workout-tracker:v2";
const SYNC_SETTINGS_KEY = "daily-workout-tracker:sync-settings:v1";

const MOCK_SESSION = buildMockSession({ id: "user-e2e-sync", email: "sync-e2e@example.com" });

// Local workout data — has Squats in main for 2026-01-01
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
      mainNotes: "local version",
      warmupTimerMs: 0,
      mainTimerMs: 0,
      weight: "",
      checkNotes: "",
    },
  },
};

// The same date in Postgres with different exercises: the sync cannot tell who is right, so it is a conflict.
const CLOUD_DAY_ROW = {
  user_id: "user-e2e-sync",
  day: "2026-01-01",
  session_type: "gym",
  warmup: [],
  main: [{ id: "m1", text: "Deadlifts", target: "3×5", done: true }],
  warmup_notes: "",
  main_notes: "cloud version",
  warmup_timer_ms: 0,
  main_timer_ms: 0,
  weight: "",
  check_notes: "",
  updated_at: "2026-06-10T14:00:00.000Z",
  deleted_at: null,
};

test.describe("Sync conflict resolution UI", () => {
  test.beforeEach(async ({ page }) => {
    // Abort any other Supabase call (auth refresh etc.) — the fake JWT never needs one
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());
    await mockUnlimitedSync(page);

    // PostgREST (registered after the catch-all above, so these take precedence). Reads return the
    // conflicting day; writes are accepted.
    await page.route("**placeholder.supabase.co/rest/v1/workout_days*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: [CLOUD_DAY_ROW] });
      } else {
        await route.fulfill({ status: 201, json: [] });
      }
    });
    for (const table of ["templates", "plans", "user_settings"]) {
      await page.route(`**placeholder.supabase.co/rest/v1/${table}*`, async (route) => {
        await route.fulfill(route.request().method() === "GET" ? { json: [] } : { status: 201, json: [] });
      });
    }

    await page.addInitScript(
      ({ sessionKey, sessionValue, onboardingKey, workoutKey, workoutValue, syncKey }) => {
        localStorage.setItem(sessionKey, JSON.stringify(sessionValue));
        localStorage.setItem(onboardingKey, "true");
        localStorage.setItem(workoutKey, JSON.stringify(workoutValue));
        // No sync base yet → local and cloud differ on the same day → conflict
        localStorage.setItem(syncKey, JSON.stringify({ mode: "cloud", lastSyncedAt: null, lastError: null }));
      },
      {
        sessionKey: SUPABASE_SESSION_KEY,
        sessionValue: MOCK_SESSION,
        onboardingKey: ONBOARDING_KEY,
        workoutKey: WORKOUT_KEY,
        workoutValue: LOCAL_WORKOUT,
        syncKey: SYNC_SETTINGS_KEY,
      }
    );
  });

  test("conflict resolution buttons appear after sync detects diverging data", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings
    await page.getByTitle("Settings").click();

    // Wait for the sync panel to appear
    await expect(page.getByText("Sync Settings")).toBeVisible({ timeout: 10_000 });

    // Sync runs on its own after sign-in, so the conflict is already waiting; no button press needed.
    // Wait for conflict UI to appear
    await expect(page.getByText("Workout data conflict")).toBeVisible({ timeout: 15_000 });

    // Both resolution options should be visible
    await expect(page.getByRole("button", { name: "Keep this device" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep cloud" })).toBeVisible();
  });

  test("resolution buttons become active after selection", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();
    await expect(page.getByText("Sync Settings")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("Workout data conflict")).toBeVisible({ timeout: 15_000 });

    // Sync Now stays disabled until a side is chosen
    await expect(page.getByRole("button", { name: "Sync Now" })).toBeDisabled();

    // Click "Keep this device" — the button should become highlighted (primary variant)
    const keepLocal = page.getByRole("button", { name: "Keep this device" });
    await keepLocal.click();

    // The Sync Now button should be re-enabled (resolution provided, can now sync)
    await expect(page.getByRole("button", { name: "Sync Now" })).toBeEnabled({ timeout: 5_000 });
  });
});
