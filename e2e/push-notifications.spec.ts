import { test, expect } from "@playwright/test";

const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";
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
      sub: "user-e2e-push",
      email: "push-e2e@example.com",
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
    refresh_token: "fake-refresh-push-e2e",
    user: {
      id: "user-e2e-push",
      aud: "authenticated",
      role: "authenticated",
      email: "push-e2e@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

const MOCK_SESSION = buildMockSession();

test.describe("Push Notifications card", () => {
  test.beforeEach(async ({ page }) => {
    // Abort Supabase auth calls — fake JWT avoids refresh
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());

    // VAPID not configured — card renders but subscription is unavailable
    await page.route("**/api/push-vapid-key", (route) =>
      route.fulfill({ status: 501, json: { error: "not configured" } })
    );

    // Mock sync API calls that fire when a session is present
    await page.route("**/api/workout-data", (route) => route.fulfill({ status: 404, json: {} }));
    await page.route("**/api/templates*", (route) => route.fulfill({ status: 404, json: {} }));
    await page.route("**/api/plans*", (route) => route.fulfill({ status: 404, json: {} }));
    await page.route("**/api/user-settings*", (route) =>
      route.fulfill({ json: { aiProvider: "google" } })
    );
    await page.route("**/api/ai-config*", (route) =>
      route.fulfill({ json: { enabledProviders: ["google"] } })
    );

    await page.addInitScript(
      ({ sessionKey, sessionValue, onboardingKey }) => {
        localStorage.setItem(sessionKey, JSON.stringify(sessionValue));
        localStorage.setItem(onboardingKey, "true");
      },
      { sessionKey: SUPABASE_SESSION_KEY, sessionValue: MOCK_SESSION, onboardingKey: ONBOARDING_KEY }
    );
  });

  test("push notifications card is visible in settings", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    await expect(page.getByText("Push Notifications")).toBeVisible({ timeout: 10_000 });
  });

  test("sign-in prompt is not shown when authenticated", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    await expect(page.getByText("Push Notifications")).toBeVisible({ timeout: 10_000 });
    // AuthGate ensures a session always exists when Settings is reached
    await expect(page.getByText("Sign in to enable push notifications.")).not.toBeVisible();
  });

  test("reminder time selector has 48 half-hour options", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    await expect(page.getByText("Push Notifications")).toBeVisible({ timeout: 10_000 });

    // The time selector should have 48 options (every 30 min over 24 hours)
    const select = page.locator("select").filter({ hasText: "AM" }).or(page.locator("select").filter({ hasText: "PM" })).first();
    const options = await select.locator("option").count();
    expect(options).toBe(48);
  });

  test("toggle is present and reflects subscription state", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    await expect(page.getByText("Push Notifications")).toBeVisible({ timeout: 10_000 });

    const toggle = page.getByRole("switch");
    await expect(toggle).toBeVisible();
    // Not subscribed yet — aria-checked should be false
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
