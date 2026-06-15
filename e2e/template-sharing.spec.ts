import { test, expect } from "@playwright/test";

const TEMPLATE_KEY = "daily-workout-tracker:templates:v1";
const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";
const SUPABASE_SESSION_KEY = "supabase.auth.token";

const MOCK_TEMPLATES = {
  gym: {
    warmup: [{ id: "w1", text: "Jump Rope", target: "3x5 min", done: false }],
    main: [
      { id: "m1", text: "Squats", target: "3×8", done: false },
      { id: "m2", text: "Deadlifts", target: "3×5", done: false },
    ],
  },
};

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
      sub: "user-e2e-templates",
      email: "templates-e2e@example.com",
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
    refresh_token: "fake-refresh-templates-e2e",
    user: {
      id: "user-e2e-templates",
      aud: "authenticated",
      role: "authenticated",
      email: "templates-e2e@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

const MOCK_SESSION = buildMockSession();

test.describe("Template export / import", () => {
  test.beforeEach(async ({ page }) => {
    // Abort Supabase auth calls — fake JWT avoids refresh
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());

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
      ({ sessionKey, sessionValue, templateKey, templateValue, onboardingKey }) => {
        localStorage.setItem(sessionKey, JSON.stringify(sessionValue));
        localStorage.setItem(templateKey, JSON.stringify(templateValue));
        localStorage.setItem(onboardingKey, "true");
      },
      {
        sessionKey: SUPABASE_SESSION_KEY,
        sessionValue: MOCK_SESSION,
        templateKey: TEMPLATE_KEY,
        templateValue: MOCK_TEMPLATES,
        onboardingKey: ONBOARDING_KEY,
      }
    );
  });

  test("export button triggers a JSON file download", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings
    await page.getByTitle("Settings").click();

    // Wait for settings page to render
    await expect(page.getByText("Templates")).toBeVisible({ timeout: 10_000 });

    // Start waiting for the download before clicking
    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Export template to file").click();
    const download = await downloadPromise;

    // Verify the download has a .json filename
    expect(download.suggestedFilename()).toMatch(/^template-.*\.json$/);
  });

  test("import file input is present in the template editor", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("Settings").click();
    await expect(page.getByText("Templates")).toBeVisible({ timeout: 10_000 });

    // The hidden file input for import should exist in the DOM
    const importButton = page.getByTitle("Import template from file");
    await expect(importButton).toBeVisible();
  });
});
