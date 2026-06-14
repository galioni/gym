import { test, expect } from "@playwright/test";

/**
 * Verifies the app renders correctly for unauthenticated users.
 * No localStorage session → AuthGate shows the landing page.
 */
test.describe("Landing page (unauthenticated)", () => {
  test("sign-in form is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("Email")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("Password")).toBeVisible();
  });

  test("Sign in and Sign up tabs are visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^sign in$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: /^sign up$/i }).first()).toBeVisible();
  });

  test("no workout data is accessible in a fresh session", async ({ page }) => {
    await page.goto("/");
    const workoutData = await page.evaluate(() =>
      localStorage.getItem("daily-workout-tracker:v2")
    );
    expect(workoutData).toBeNull();
  });
});
