#!/usr/bin/env node
/**
 * End-to-end test of cross-browser sync against the running gym-app stack (`npm run gym:up` first).
 *
 * Environment: GYM_BROWSER=chromium|webkit|firefox (default chromium), GYM_DEVICE="iPhone 13" for a phone
 * profile, GYM_SCENARIOS=sync,delete,settings (default all three; deletion and the plans screen are
 * desktop-oriented, so a phone profile runs `sync` only).
 *
 * Two Playwright contexts act as two separate browsers (no shared storage or session) for one account:
 *   1. a note typed in browser A reaches Postgres on its own, with no button pressed
 *   2. a brand-new browser B signs in and receives it, skipping onboarding
 *   3. edits flow both ways without either overwriting the other
 *   4. a same-day edit made offline on A while B edits the same day is surfaced, never silently lost
 *   5. a day deleted in B is soft-deleted in Postgres, removed from A, and stays gone
 *   6. templates, plans and the active plan follow the account; different templates edited on each device
 *      merge without a conflict
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, firefox, webkit } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "http://localhost:5180/";
const PASSWORD = "Passw0rd!local";
const PROJECT = process.env.GYM_PROJECT ?? "gym-app";
const ENGINE = { chromium, webkit, firefox }[process.env.GYM_BROWSER ?? "chromium"];
const DEVICE = process.env.GYM_DEVICE;
const SCENARIOS = (process.env.GYM_SCENARIOS ?? "sync,delete,settings").split(",");
if (!ENGINE) throw new Error(`Unknown GYM_BROWSER: ${process.env.GYM_BROWSER}`);
if (DEVICE && !devices[DEVICE]) throw new Error(`Unknown GYM_DEVICE: ${DEVICE}`);
const CONTEXT_OPTIONS = DEVICE ? devices[DEVICE] : { viewport: { width: 1100, height: 900 } };
const newPage = async (browser) => (await browser.newContext(CONTEXT_OPTIONS)).newPage();
let failures = 0;

function psql(sql) {
  return execSync(
    `docker compose --env-file .env.local -f docker/compose.yaml -p ${PROJECT} exec -T db psql -U postgres -h 127.0.0.1 -Atc "${sql}"`,
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
}
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures += 1;
};
async function waitFor(fn, ms = 25000, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  return false;
}
const notesBox = (page) => page.getByPlaceholder("Log weights, feelings, or adjustments...").last();
const localDays = (page) =>
  page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("daily-workout-tracker:v2") || '{"data":{}}').data));

async function signUpAndSkipOnboarding(page, email) {
  await page.goto(BASE);
  await page.getByRole("button", { name: /^sign up$/i }).first().click();
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForSelector("text=Build your plan", { timeout: 20000 });
  await page.getByText(/skip/i).first().click();
  await notesBox(page).waitFor();
}
async function signIn(page, email) {
  await page.goto(BASE);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).last().click();
}

async function scenarioSyncAndConflict(browser) {
  console.log("\n== sync both ways, new browser, offline clash ==");
  const email = `sync${Date.now() % 1000000}@gym.local`;
  const row = (field) =>
    psql(`select ${field} from workout_days wd join auth.users u on u.id = wd.user_id where u.email = '${email}' order by day desc limit 1`);
  const A = await newPage(browser);
  const ctxA = A.context();
  const B = await newPage(browser);

  await signUpAndSkipOnboarding(A, email);
  await notesBox(A).fill("written in browser A");
  check(await waitFor(() => row("main_notes") === "written in browser A"), "A: a typed note reaches Postgres automatically");

  await signIn(B, email);
  check(await waitFor(async () => (await notesBox(B).count()) > 0), "B: a fresh browser reaches the dashboard (onboarding skipped)");
  check(await waitFor(async () => (await notesBox(B).inputValue().catch(() => "")) === "written in browser A"), "B: A's note appears on the new browser");

  await notesBox(B).fill("edited in browser B");
  check(await waitFor(() => row("main_notes") === "edited in browser B"), "B: its edit reaches Postgres");
  await A.reload();
  check(await waitFor(async () => (await notesBox(A).inputValue().catch(() => "")) === "edited in browser B"), "A: after reload shows B's edit (A's older copy did not clobber it)");

  await ctxA.setOffline(true);
  await notesBox(A).fill("A offline edit");
  await notesBox(B).fill("B online edit");
  check(await waitFor(() => row("main_notes") === "B online edit"), "B: online edit reaches Postgres while A is offline");
  await ctxA.setOffline(false);
  await A.evaluate(() => window.dispatchEvent(new Event("online")));
  check(await waitFor(async () => (await A.getByText("Sync needs your attention").count()) > 0), "A: back online, the same-day clash is surfaced to the user");
  check(row("main_notes") === "B online edit", "the unresolved clash did not overwrite Postgres");
  check((await notesBox(A).inputValue()) === "A offline edit", "A still shows its own edit (nothing lost locally)");
  await A.context().close();
  await B.context().close();
}

async function scenarioDelete(browser) {
  console.log("\n== deletion propagates and stays deleted ==");
  const email = `del${Date.now() % 1000000}@gym.local`;
  const q = (cols, where = "") =>
    psql(`select ${cols} from workout_days wd join auth.users u on u.id = wd.user_id where u.email = '${email}' ${where}`);
  const A = await newPage(browser);
  const B = await newPage(browser);

  await signUpAndSkipOnboarding(A, email);
  await notesBox(A).fill("a day I will delete");
  // History only lists days with real content (a weight counts).
  await A.getByPlaceholder("e.g. 79.5").fill("80");
  check(await waitFor(() => q("main_notes") === "a day I will delete"), "setup: the day is in Postgres");

  await signIn(B, email);
  check(await waitFor(async () => (await notesBox(B).count()) > 0 && (await notesBox(B).inputValue()) === "a day I will delete"), "setup: B has pulled the day");

  if (DEVICE) {
    await B.getByRole("button", { name: "Toggle menu" }).click();
    await B.getByRole("button", { name: "History", exact: true }).click();
  } else {
    await B.locator("header button[title='History']").click();
  }
  await B.waitForSelector("[aria-label='Delete day']", { state: "attached", timeout: 10000 });
  await B.locator("[aria-label='Delete day']").first().click({ force: true });
  const dialog = B.getByRole("alertdialog");
  if (await dialog.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
    await dialog.getByRole("button").last().click();
  }

  check(await waitFor(() => q("count(*)", "and wd.deleted_at is not null") === "1"), "B: the deletion reaches Postgres as a soft delete");
  check(q("count(*)", "and wd.deleted_at is null") === "0", "no live copy of the day remains");
  check((await localDays(A)).length === 1, "A still has its unchanged local copy before it syncs");
  await A.reload();
  check(await waitFor(async () => (await localDays(A)).length === 0), "A: the unchanged copy is removed once A syncs");

  await A.waitForTimeout(8000);
  await B.reload();
  await B.waitForTimeout(5000);
  check((await localDays(A)).length === 0 && (await localDays(B)).length === 0, "the day stays deleted in both browsers after further syncs");
  check(q("count(*)", "and wd.deleted_at is null") === "0", "and does not reappear in Postgres");
  await A.context().close();
  await B.context().close();
}

console.log(`engine: ${process.env.GYM_BROWSER ?? "chromium"}${DEVICE ? `, device: ${DEVICE}` : ""}, scenarios: ${SCENARIOS.join(",")}`);
const TEMPLATES_KEY = "daily-workout-tracker:templates:v1";
const PLANS_KEY = "daily-workout-tracker:plans:v1";
const ACTIVE_PLAN_KEY = "daily-workout-tracker:active-plan:v1";
const PARAMS_KEY = "daily-workout-tracker:plan-params:v1";
/** Sync runs when the connection returns, so this makes a page sync now without touching the UI. */
const syncNow = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const storedTemplateText = (page, session) =>
  page.evaluate(([key, name]) => JSON.parse(localStorage.getItem(key) || "{}").templates?.[name]?.main?.[0]?.text ?? null, [TEMPLATES_KEY, session]);
const editStoredTemplate = (page, session, text) =>
  page.evaluate(([key, name, value]) => {
    const raw = JSON.parse(localStorage.getItem(key));
    raw.templates[name].main[0].text = value;
    raw.updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(raw));
  }, [TEMPLATES_KEY, session, text]);

async function scenarioTemplatesAndSettings(browser) {
  console.log("\n== templates, plans and settings follow the account ==");
  const email = `set${Date.now() % 1000000}@gym.local`;
  const sql = (query) =>
    psql(`select ${query.select} from ${query.from} t join auth.users u on u.id = t.user_id where u.email = '${email}' ${query.where ?? ""}`);
  const A = await newPage(browser);
  const B = await newPage(browser);

  await signUpAndSkipOnboarding(A, email);
  await A.evaluate(([templates, plans, active, params]) => {
    const now = new Date().toISOString();
    const item = (text) => ({ warmup: [], main: [{ text, target: "3x8" }] });
    localStorage.setItem(templates, JSON.stringify({ version: 1, updatedAt: now, templates: { push: { label: "Push day", ...item("Bench press") }, legs: { label: "Leg day", ...item("Squat") } } }));
    localStorage.setItem(plans, JSON.stringify({ version: 1, updatedAt: now, plans: [
      { id: "p1", label: "Strength block", sessionIds: ["push", "legs"] },
      { id: "p2", label: "Easy week", sessionIds: ["legs"] },
    ] }));
    localStorage.setItem(active, "p1");
    localStorage.setItem(params, JSON.stringify({ goal: "strength", experience: "beginner", daysPerWeek: 3, equipment: "full_gym", duration: "45", bodyFocus: [] }));
  }, [TEMPLATES_KEY, PLANS_KEY, ACTIVE_PLAN_KEY, PARAMS_KEY]);
  await syncNow(A);
  check(await waitFor(() => sql({ select: "count(*)", from: "templates", where: "and t.session_type in ('push','legs')" }) === "2"), "A: templates reach Postgres");
  check(await waitFor(() => sql({ select: "count(*)", from: "plans" }) === "2"), "A: plans reach Postgres");
  check(await waitFor(() => sql({ select: "t.active_plan_id", from: "user_settings" }) === "p1"), "A: the active plan reaches Postgres");
  check(sql({ select: "t.plan_params->>'goal'", from: "user_settings" }) === "strength", "A: the plan details reach Postgres");

  await signIn(B, email);
  check(await waitFor(async () => (await storedTemplateText(B, "push")) === "Bench press"), "B: a new browser receives the templates");
  check(await waitFor(async () => (await B.evaluate((k) => localStorage.getItem(k), ACTIVE_PLAN_KEY)) === "p1"), "B: and the active plan");
  check(await waitFor(async () => (await B.evaluate((k) => localStorage.getItem(k), PARAMS_KEY)) !== null), "B: and the plan details");

  // B's open screen reflects what arrived (no manual reload).
  await B.locator("header button[title='Settings']").click();
  check(await waitFor(async () => (await B.getByText("Strength block").count()) > 0, 15000), "B: the Plans screen shows the synced plans without a reload");

  // Different templates edited on each device merge with no conflict.
  await editStoredTemplate(A, "push", "Incline bench");
  await editStoredTemplate(B, "legs", "Front squat");
  await syncNow(A);
  check(await waitFor(() => sql({ select: "t.main->0->>'text'", from: "templates", where: "and t.session_type = 'push'" }) === "Incline bench"), "A: its template edit reaches Postgres");
  await syncNow(B);
  check(await waitFor(() => sql({ select: "t.main->0->>'text'", from: "templates", where: "and t.session_type = 'legs'" }) === "Front squat"), "B: its edit to a DIFFERENT template reaches Postgres");
  check(await waitFor(async () => (await storedTemplateText(B, "push")) === "Incline bench"), "B: and receives A's edit");
  check((await B.getByText("Sync needs your attention").count()) === 0, "no conflict was raised for edits to different templates");
  await syncNow(A);
  check(await waitFor(async () => (await storedTemplateText(A, "legs")) === "Front squat"), "A: receives B's edit too");

  // The active plan follows the account, using the real UI.
  await B.getByRole("button", { name: "Set active" }).first().click();
  check(await waitFor(() => sql({ select: "t.active_plan_id", from: "user_settings" }) === "p2"), "B: choosing a plan as active reaches Postgres");
  await syncNow(A);
  check(await waitFor(async () => (await A.evaluate((k) => localStorage.getItem(k), ACTIVE_PLAN_KEY)) === "p2"), "A: the active plan follows");
  await A.context().close();
  await B.context().close();
}

const browser = await ENGINE.launch();
try {
  if (SCENARIOS.includes("sync")) await scenarioSyncAndConflict(browser);
  if (SCENARIOS.includes("delete")) await scenarioDelete(browser);
  if (SCENARIOS.includes("settings")) await scenarioTemplatesAndSettings(browser);
} catch (error) {
  console.error("SCRIPT ERROR", String(error?.message ?? error).split("\n")[0]);
  failures += 1;
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nE2E SYNC PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
