import { test, expect } from "@playwright/test";

const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";
const WORKOUT_KEY = "daily-workout-tracker:v2";
const SYNC_SETTINGS_KEY = "daily-workout-tracker:sync-settings:v1";
// @supabase/auth-js GoTrueClient default storage key
const SUPABASE_SESSION_KEY = "supabase.auth.token";

function buildMockSession() {
  const b64url = (data: unknown) =>
    Buffer.from(JSON.stringify(data))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const jwt = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({
      sub: "user-e2e-sync",
      email: "sync-e2e@example.com",
      role: "authenticated",
      aud: "authenticated",
      exp: 1893456000,
      iat: 1718352000,
    }),
    "fakesig",
  ].join(".");

  return {
    access_token: jwt,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1893456000,
    refresh_token: "fake-refresh-sync-e2e",
    user: {
      id: "user-e2e-sync",
      aud: "authenticated",
      role: "authenticated",
      email: "sync-e2e@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

const MOCK_SESSION = buildMockSession();

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

// Cloud workout data for the same date but with different exercises — triggers a conflict
const CLOUD_WORKOUT_RESPONSE = {
  version: 1,
  updatedAt: "2026-06-10T14:00:00.000Z",
  data: {
    "2026-01-01": {
      date: "2026-01-01",
      sessionType: "gym",
      warmup: [],
      main: [{ id: "m1", text: "Deadlifts", target: "3×5", done: true }],
      warmupNotes: "",
      mainNotes: "cloud version",
      warmupTimerMs: 0,
      mainTimerMs: 0,
      weight: "",
      checkNotes: "",
    },
  },
};

test.describe("Sync conflict resolution UI", () => {
  test.beforeEach(async ({ page }) => {
    // Abort Supabase auth endpoint calls — fake JWT avoids refresh
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());

    // Mock cloud workout-data endpoint — returns conflicting data
    await page.route("**/api/workout-data", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: CLOUD_WORKOUT_RESPONSE });
      } else {
        await route.fulfill({ json: { ok: true } });
      }
    });

    // Mock templates — no cloud data (404 → no template conflict)
    await page.route("**/api/templates*", async (route) => {
      await route.fulfill({ status: 404, json: { error: "not found" } });
    });

    // Mock plans — no cloud data
    await page.route("**/api/plans*", async (route) => {
      await route.fulfill({ status: 404, json: { error: "not found" } });
    });

    await page.addInitScript(
      ({ sessionKey, sessionValue, onboardingKey, workoutKey, workoutValue, syncKey }) => {
        localStorage.setItem(sessionKey, JSON.stringify(sessionValue));
        localStorage.setItem(onboardingKey, "true");
        localStorage.setItem(workoutKey, JSON.stringify(workoutValue));
        // No lastSyncedAt → first sync; both local and cloud have changes → conflict
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

    // Trigger sync
    await page.getByRole("button", { name: "Sync Now" }).click();

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

    await page.getByRole("button", { name: "Sync Now" }).click();
    await expect(page.getByText("Workout data conflict")).toBeVisible({ timeout: 15_000 });

    // Click "Keep this device" — the button should become highlighted (primary variant)
    const keepLocal = page.getByRole("button", { name: "Keep this device" });
    await keepLocal.click();

    // The Sync Now button should be re-enabled (resolution provided, can now sync)
    await expect(page.getByRole("button", { name: "Sync Now" })).toBeEnabled({ timeout: 5_000 });
  });
});
