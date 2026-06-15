import { test, expect } from "@playwright/test";

const TEMPLATE_KEY = "daily-workout-tracker:templates:v1";
const ONBOARDING_KEY = "daily-workout-tracker:onboarded:v1";

const MOCK_TEMPLATES = {
  gym: {
    warmup: [{ id: "w1", text: "Jump Rope", target: "3x5 min", done: false }],
    main: [
      { id: "m1", text: "Squats", target: "3×8", done: false },
      { id: "m2", text: "Deadlifts", target: "3×5", done: false },
    ],
  },
};

test.describe("Template export / import", () => {
  test.beforeEach(async ({ page }) => {
    // Abort Supabase auth calls — session is not needed for template sharing
    await page.route("**placeholder.supabase.co/**", (route) => route.abort());

    await page.addInitScript(
      ({ templateKey, templateValue, onboardingKey }) => {
        localStorage.setItem(templateKey, JSON.stringify(templateValue));
        localStorage.setItem(onboardingKey, "true");
      },
      {
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
