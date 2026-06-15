import { test, expect } from "@playwright/test";

/**
 * Builds a mock Supabase session with a far-future expiry (2030-01-01).
 * The stored session is read by Supabase JS directly from localStorage without
 * a network call as long as expires_at > Date.now()/1000 + refresh_margin.
 */
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
      sub: "user-e2e-test",
      email: "e2e@example.com",
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
    refresh_token: "fake-refresh-for-e2e",
    user: {
      id: "user-e2e-test",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

/**
 * @supabase/auth-js GoTrueClient defaults to "supabase.auth.token" as the storage key
 * when no custom storageKey is provided (see GoTrueClient constructor / STORAGE_KEY constant).
 */
const SUPABASE_SESSION_KEY = "supabase.auth.token";
const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";

const MOCK_SESSION = buildMockSession();

test.describe("Authenticated state (mocked session)", () => {
  test.beforeEach(async ({ page }) => {
    // Abort all Supabase network calls so tests never depend on external services.
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());

    // Inject session + onboarding flag before any JS runs on the page.
    await page.addInitScript(
      ({ sessionKey, sessionValue, onboardingKey }) => {
        localStorage.setItem(sessionKey, JSON.stringify(sessionValue));
        localStorage.setItem(onboardingKey, "true");
      },
      {
        sessionKey: SUPABASE_SESSION_KEY,
        sessionValue: MOCK_SESSION,
        onboardingKey: ONBOARDING_KEY,
      }
    );
  });

  test("dashboard renders instead of the landing page", async ({ page }) => {
    await page.goto("/");
    // Landing page email input should not be visible once signed in
    await expect(page.getByPlaceholder("Email")).not.toBeVisible({ timeout: 10_000 });
    // UserMenu shows the signed-in email
    await expect(page.getByText("e2e@example.com")).toBeVisible({ timeout: 10_000 });
  });

  test("session persists after a page reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("e2e@example.com")).toBeVisible({ timeout: 10_000 });

    await page.reload();

    await expect(page.getByText("e2e@example.com")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("Email")).not.toBeVisible();
  });

  test("workout data written in-session is accessible after reload", async ({ page }) => {
    const WORKOUT_KEY = "daily-workout-tracker:v2";

    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          updatedAt: "2026-06-01T10:00:00.000Z",
          data: {
            "2026-06-01": {
              date: "2026-06-01",
              sessionType: "gym",
              warmup: [],
              main: [],
              warmupNotes: "auth-session-persistence",
              mainNotes: "",
              warmupTimerMs: 0,
              mainTimerMs: 0,
              weight: "",
              checkNotes: "",
            },
          },
        })
      );
    }, WORKOUT_KEY);

    await page.goto("/");
    await page.reload();

    const stored = await page.evaluate((k) => localStorage.getItem(k), WORKOUT_KEY);
    const parsed = JSON.parse(stored!) as { data: Record<string, { warmupNotes: string }> };
    expect(parsed.data["2026-06-01"].warmupNotes).toBe("auth-session-persistence");
  });
});
