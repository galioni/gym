import { test, expect } from "@playwright/test";

const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";

test.describe("Push Notifications card (unauthenticated)", () => {
  test.beforeEach(async ({ page }) => {
    // Abort Supabase auth calls so no session loads
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());

    // Mock VAPID key endpoint — card renders differently depending on whether VAPID is configured
    await page.route("**/api/push-vapid-key", (route) =>
      route.fulfill({ status: 501, json: { error: "not configured" } })
    );

    await page.addInitScript(
      ({ onboardingKey }) => {
        localStorage.setItem(onboardingKey, "true");
      },
      { onboardingKey: ONBOARDING_KEY }
    );
  });

  test("push notifications card is visible in settings", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    await expect(page.getByText("Push Notifications")).toBeVisible({ timeout: 10_000 });
  });

  test("sign-in prompt is shown when not authenticated", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    // The card should show the auth requirement message
    await expect(page.getByText("Sign in to enable push notifications.")).toBeVisible({
      timeout: 10_000,
    });
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

  test("toggle is disabled when not authenticated", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Settings").click();

    await expect(page.getByText("Push Notifications")).toBeVisible({ timeout: 10_000 });

    const toggle = page.getByRole("switch");
    // Disabled attribute may not be reflected in aria, but the button should be disabled
    await expect(toggle).toBeDisabled();
  });
});
