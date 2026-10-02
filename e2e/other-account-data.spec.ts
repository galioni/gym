import { test, expect } from "@playwright/test";
import { buildMockSession, SUPABASE_SESSION_KEY } from "./helpers/mockSession";

const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";
const WORKOUT_KEY = "daily-workout-tracker:v2";
const OWNER_KEY = "daily-workout-tracker:sync-owner:v1";
const SYNC_SETTINGS_KEY = "daily-workout-tracker:sync-settings:v1";

const NEW_ACCOUNT = buildMockSession({ id: "account-new", email: "new-account@example.com" });

const OTHER_ACCOUNTS_WORKOUT = {
  version: 1,
  updatedAt: "2026-06-10T12:00:00.000Z",
  data: {
    "2026-01-01": {
      date: "2026-01-01",
      sessionType: "gym",
      warmup: [],
      main: [{ id: "m1", text: "Squats", target: "3×8", done: true }],
      warmupNotes: "",
      mainNotes: "the other account's workout",
      warmupTimerMs: 0,
      mainTimerMs: 0,
      weight: "",
      checkNotes: "",
    },
  },
};

/**
 * A new Free account signs in on a browser that already synced for a different account. Free accounts do not sync on their
 * own after the first time, so nothing used to ask whose data this was: the other account's workouts just sat on screen,
 * and "Sync now" would have uploaded them to the new account.
 */
test.describe("Another account's data on this browser", () => {
  let writes: string[];

  test.beforeEach(async ({ page }) => {
    writes = [];
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());
    // A Free plan: the allowance is enforced, the account is not Pro.
    await page.route("**placeholder.supabase.co/rest/v1/rpc/begin_sync*", (route) =>
      route.fulfill({ json: [{ allowed: true, window_ends_at: null, next_available_at: null }] })
    );
    await page.route("**placeholder.supabase.co/rest/v1/rpc/sync_allowance*", (route) =>
      route.fulfill({ json: [{ enforced: true, is_pro: false, window_ends_at: null, next_available_at: null }] })
    );
    for (const table of ["workout_days", "templates", "plans", "user_settings"]) {
      await page.route(`**placeholder.supabase.co/rest/v1/${table}*`, async (route) => {
        if (route.request().method() !== "GET") writes.push(`${route.request().method()} ${table}`);
        await route.fulfill(route.request().method() === "GET" ? { json: [] } : { status: 201, json: [] });
      });
    }

    await page.addInitScript(
      (seed) => {
        // This script runs again on every page load, including the reload after "Switch to this account": seed only once.
        if (localStorage.getItem("e2e-seeded")) return;
        localStorage.setItem("e2e-seeded", "1");
        localStorage.setItem(seed.sessionKey, JSON.stringify(seed.session));
        localStorage.setItem(seed.onboardingKey, "true");
        localStorage.setItem(seed.workoutKey, JSON.stringify(seed.workout));
        localStorage.setItem(seed.ownerKey, "account-previous");
        // The browser has synced before (for the previous account), which is what keeps a Free account from syncing on its own.
        localStorage.setItem(seed.settingsKey, JSON.stringify({ mode: "cloud", lastSyncedAt: "2026-09-01T10:00:00.000Z", lastError: null }));
      },
      {
        sessionKey: SUPABASE_SESSION_KEY,
        session: NEW_ACCOUNT,
        onboardingKey: ONBOARDING_KEY,
        workoutKey: WORKOUT_KEY,
        workout: OTHER_ACCOUNTS_WORKOUT,
        ownerKey: OWNER_KEY,
        settingsKey: SYNC_SETTINGS_KEY,
      }
    );
  });

  test("asks which account the data belongs to, and sends nothing to the cloud", async ({ page }) => {
    await page.goto("/");

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Another account's data is on this device")).toBeVisible({ timeout: 15_000 });
    expect(writes).toEqual([]);
  });

  test("switching to this account removes the other account's workouts from the browser", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Another account's data is on this device")).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole("button", { name: "Switch to this account" }).click();
    await page.waitForLoadState("load");

    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), OWNER_KEY)).toBe("account-new");
    const stored = await page.evaluate((key) => localStorage.getItem(key), WORKOUT_KEY);
    expect(stored ?? "").not.toContain("the other account's workout");
    expect(writes).toEqual([]);
  });
});
