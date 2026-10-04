#!/usr/bin/env node
/**
 * End-to-end test of cross-browser sync against the running gym-app stack (`npm run gym:up` first).
 *
 * Environment: GYM_BROWSER=chromium|webkit|firefox (default chromium), GYM_DEVICE="iPhone 13" for a phone
 * profile, GYM_SCENARIOS=sync,delete,settings,limits,allowance,history (default all six; deletion and the plans screen are
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
const SCENARIOS = (process.env.GYM_SCENARIOS ?? "sync,delete,settings,limits,allowance,history").split(",");
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
  // Wait for the weight too: B lists the day in History only once it has content, and a day pulled before the weight arrived
  // has none (B would then have nothing to delete, which is the test racing itself, not a sync fault).
  check(await waitFor(() => q("main_notes || '|' || weight") === "a day I will delete|80"), "setup: the day is in Postgres");

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
  check(q("count(*)", "and wd.deleted_at is not null and wd.main_notes = '' and wd.main = '[]'::jsonb and wd.deleted_hash is not null") === "1",
    "the deleted day holds no content, only its marker and hash");
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

async function scenarioFreeLimits(browser) {
  console.log("\n== a Free account reaches its template limit without losing anything ==");
  const email = `lim${Date.now() % 1000000}@gym.local`;
  const cloudTemplates = () =>
    psql(`select count(*) from templates t join auth.users u on u.id = t.user_id where u.email = '${email}' and t.deleted_at is null`);
  const cloudText = (session) =>
    psql(`select t.main->0->>'text' from templates t join auth.users u on u.id = t.user_id where u.email = '${email}' and t.session_type = '${session}'`);
  const localTemplateCount = (page) =>
    page.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) || "{}").templates ?? {}).length, TEMPLATES_KEY);

  const A = await newPage(browser);
  await signUpAndSkipOnboarding(A, email);
  await A.evaluate((key) => {
    const templates = {};
    for (let i = 1; i <= 7; i += 1) templates[`t${i}`] = { label: `Template ${i}`, warmup: [], main: [{ text: `Move ${i}`, target: "3x8" }] };
    localStorage.setItem(key, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), templates }));
  }, TEMPLATES_KEY);
  await syncNow(A);

  check(await waitFor(() => cloudTemplates() === "5"), "Free: only 5 of the 7 templates reach Postgres (the Free cap), not none");
  check(await waitFor(async () => (await A.getByText("Cloud storage limit reached").count()) > 0, 15000), "Free: the app explains the limit");
  check((await localTemplateCount(A)) === 7, "Free: all 7 templates are still on this device");

  // An edit to a template that is already in the cloud must not be held back by the 2 that are over the limit.
  await editStoredTemplate(A, "t1", "t1 edited");
  await syncNow(A);
  check(await waitFor(() => cloudText("t1") === "t1 edited"), "Free: an edit to a synced template still reaches Postgres while 2 templates are over the limit");

  // Deleting one makes room for exactly one more, in the same sync.
  await A.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key));
    delete raw.templates.t5;
    raw.updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(raw));
  }, TEMPLATES_KEY);
  await syncNow(A);
  check(await waitFor(() => psql(`select count(*) from templates t join auth.users u on u.id = t.user_id where u.email = '${email}' and t.session_type = 't5'`) === "0"), "Free: a template deleted on the device is removed from Postgres");
  check(await waitFor(() => cloudTemplates() === "5"), "Free: and the freed room is used by a template that was over the limit");

  // Upgrading lifts the cap; the rest syncs on the next sync.
  psql(`insert into public.subscriptions (user_id, plan, status) select id, 'pro', 'active' from auth.users where email = '${email}'`);
  await syncNow(A);
  check(await waitFor(() => cloudTemplates() === "6"), "after upgrading to Pro, the remaining template syncs (6 on the device, 6 in Postgres)");
  // Leave no billing rows behind: the database tests assume a database without subscriptions.
  psql(`delete from public.subscriptions where user_id in (select id from auth.users where email = '${email}')`);
  await A.context().close();
}

async function scenarioFreeAllowance(browser) {
  console.log("\n== a Free account syncs once a month, by hand ==");
  const email = `allow${Date.now() % 1000000}@gym.local`;
  const userId = () => psql(`select id from auth.users where email = '${email}'`);
  const cloudNote = () =>
    psql(`select coalesce(string_agg(main_notes, '|'), '') from workout_days w join auth.users u on u.id = w.user_id where u.email = '${email}'`);
  const setWindowAge = (minutes) =>
    psql(`insert into public.sync_windows (user_id, opened_at) values ('${userId()}', now() - interval '${minutes} minutes') on conflict (user_id) do update set opened_at = excluded.opened_at`);
  const openSettings = async (page) => {
    await page.locator("header button[title='Settings']").click();
    await page.getByRole("heading", { name: "Sync Settings", exact: true }).waitFor();
  };
  const syncNowButton = (page) => page.getByRole("button", { name: "Sync now" }).first();

  // The allowance ships switched off; this scenario switches it on and always off again.
  psql("update public.app_flags set enabled = true where name = 'sync_allowance'");
  try {
    const A = await newPage(browser);
    await signUpAndSkipOnboarding(A, email);

    // A new device syncs once on its own. With nothing to upload it spends nothing.
    check(await waitFor(async () => (await A.locator("header button[aria-label^='Sync status: Synced']").count()) > 0, 20000), "Free: the first sync of a new device runs on its own");
    check(psql(`select count(*) from sync_windows where user_id = '${userId()}'`) === "0", "Free: and, having nothing to upload, it did not spend the month");

    // After that a Free account does not sync on its own.
    await notesBox(A).fill("first month note");
    await A.waitForTimeout(7000);
    check(cloudNote() === "", "Free: later edits stay on the device and are not uploaded automatically");

    // By hand, with a clear warning first.
    await openSettings(A);
    check((await A.getByText("Free plan: one sync every 30 days").count()) > 0, "Free: Settings explains the plan");
    check(await syncNowButton(A).isEnabled(), "Free: Sync now is available");
    await syncNowButton(A).click();
    const dialog = A.getByRole("alertdialog");
    await dialog.waitFor({ timeout: 5000 });
    check((await dialog.getByText("Use this month's sync?").count()) > 0, "Free: Sync now first asks before using the month's sync");
    check(cloudNote() === "", "Free: nothing is uploaded until the person confirms");
    await dialog.getByRole("button", { name: "Not now" }).click();
    await A.waitForTimeout(1500);
    check(cloudNote() === "", "Free: cancelling uploads nothing");

    await syncNowButton(A).click();
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByRole("button", { name: "Sync now" }).click();
    check(await waitFor(() => cloudNote() === "first month note"), "Free: confirming uploads the edits");
    check(psql(`select count(*) from sync_windows where user_id = '${userId()}'`) === "1", "Free: and that upload used the month");

    // Window closed, month used: the screen says when, and the button waits.
    setWindowAge(11);
    await A.reload();
    await notesBox(A).fill("second note, same month");
    await openSettings(A);
    check(await waitFor(async () => (await A.getByText(/has been used\. The next one is available on/).count()) > 0, 15000), "Free: Settings says the month's sync is used and when the next opens");
    check(await syncNowButton(A).isDisabled(), "Free: Sync now waits until then");
    await A.waitForTimeout(5000);
    check(cloudNote() === "first month note", "Free: nothing is uploaded in the meantime, and nothing is lost on the device");

    // Thirty days later it is available again.
    setWindowAge(31 * 24 * 60);
    await A.reload();
    await openSettings(A);
    check(await waitFor(async () => await syncNowButton(A).isEnabled(), 15000), "Free: after 30 days Sync now is available again");
    await syncNowButton(A).click();
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByRole("button", { name: "Sync now" }).click();
    check(await waitFor(() => cloudNote() === "second note, same month"), "Free: and uploads what accumulated");
    await A.context().close();
  } finally {
    psql("update public.app_flags set enabled = false where name = 'sync_allowance'");
    psql(`delete from public.sync_windows where user_id in (select id from auth.users where email = '${email}')`);
  }
}

async function scenarioFreeHistory(browser) {
  console.log("\n== a Free account keeps only the last 7 days in the cloud ==");
  const email = `hist${Date.now() % 1000000}@gym.local`;
  const cloudDays = () =>
    psql(`select coalesce(string_agg(main_notes, '|' order by day), '') from workout_days w join auth.users u on u.id = w.user_id where u.email = '${email}'`);
  psql("update public.app_flags set enabled = true where name in ('sync_allowance', 'free_history_window')");
  try {
    const A = await newPage(browser);
    await signUpAndSkipOnboarding(A, email);
    check(await waitFor(async () => (await A.locator("header button[aria-label^='Sync status: Synced']").count()) > 0, 20000), "History: the first sync of a new device runs on its own");

    // A day 40 days ago exists only on this device.
    await A.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 40);
      const pad = (n) => String(n).padStart(2, "0");
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const raw = JSON.parse(localStorage.getItem("daily-workout-tracker:v2") ?? "{}");
      raw.version = raw.version ?? 1;
      raw.updatedAt = new Date().toISOString();
      raw.data = { ...(raw.data ?? {}), [key]: { sessionType: "push", mainNotes: "old day, device only" } };
      localStorage.setItem("daily-workout-tracker:v2", JSON.stringify(raw));
    });
    await A.reload();
    await notesBox(A).fill("today, goes to the cloud");

    await A.locator("header button[title='Settings']").click();
    await A.getByRole("heading", { name: "Sync Settings", exact: true }).waitFor();
    check((await A.getByText(/last 7 days; older entries stay on this device/).count()) > 0, "History: Settings says the cloud keeps 7 days");
    await A.getByRole("button", { name: "Sync now" }).first().click();
    const dialog = A.getByRole("alertdialog");
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByRole("button", { name: "Sync now" }).click();

    check(await waitFor(() => cloudDays() === "today, goes to the cloud"), "History: only today's day reached the cloud", cloudDays());
    const local = await A.evaluate(() => localStorage.getItem("daily-workout-tracker:v2") ?? "");
    check(local.includes("old day, device only"), "History: the old day is still on the device");
    check(psql(`select count(*) from workout_days w join auth.users u on u.id = w.user_id where u.email = '${email}' and w.day < current_date - 10`) === "0", "History: nothing older than the window is in the cloud");
    await A.context().close();
  } finally {
    psql("update public.app_flags set enabled = false where name in ('sync_allowance', 'free_history_window')");
    psql(`delete from public.sync_windows where user_id in (select id from auth.users where email = '${email}')`);
  }
}

const browser = await ENGINE.launch();
try {
  if (SCENARIOS.includes("sync")) await scenarioSyncAndConflict(browser);
  if (SCENARIOS.includes("delete")) await scenarioDelete(browser);
  if (SCENARIOS.includes("settings")) await scenarioTemplatesAndSettings(browser);
  if (SCENARIOS.includes("limits")) await scenarioFreeLimits(browser);
  if (SCENARIOS.includes("allowance")) await scenarioFreeAllowance(browser);
  if (SCENARIOS.includes("history")) await scenarioFreeHistory(browser);
} catch (error) {
  console.error("SCRIPT ERROR", String(error?.message ?? error).split("\n")[0]);
  failures += 1;
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nE2E SYNC PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
