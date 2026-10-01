#!/usr/bin/env node
/**
 * End-to-end check of the data path the browser will use, against the running gym-app stack:
 *   real GoTrue sign-up -> real JWT -> gateway -> PostgREST -> RLS.
 * Complements supabase/tests/rls.test.sql (which forges claims inside Postgres) by proving the JWT secret,
 * role mapping and routing agree across auth, rest and db. Creates two throwaway users and deletes them.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const BASE = "http://localhost:54321";
const ANON = env.GYM_ANON_KEY;
const SERVICE = env.GYM_SERVICE_ROLE_KEY;
let failures = 0;

function check(condition, label, detail = "") {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL - ${label} ${detail}`);
  }
}

async function call(method, route, { token = ANON, apikey = ANON, body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}

async function signUp(label) {
  const email = `smoke-${label}-${Date.now()}@gym.local`;
  const res = await call("POST", "/auth/v1/signup", { body: { email, password: "Passw0rd!local" } });
  if (!res.json?.access_token) throw new Error(`sign-up failed for ${label}: ${res.status} ${res.text}`);
  return { id: res.json.user.id, token: res.json.access_token };
}

const day = {
  day: "2026-10-01",
  session_type: "gym",
  warmup: [{ id: "w1", text: "Band pull-aparts", target: "2x15", done: true }],
  main: [{ id: "m1", text: "Back squat", target: "3x8", done: false }],
  main_notes: "felt strong",
  weight: "79,5",
};

const a = await signUp("a");
const b = await signUp("b");
const ids = [a.id, b.id];

try {
  // A writes a day through the same upsert the sync layer will use.
  let res = await call("POST", "/rest/v1/workout_days?on_conflict=user_id,day", {
    token: a.token,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { ...day, user_id: a.id, updated_at: "2001-01-01T00:00:00Z" },
  });
  check(res.status === 201 && res.json?.[0]?.user_id === a.id, "A upserts a day via PostgREST", `(${res.status} ${res.text})`);
  check(new Date(res.json?.[0]?.updated_at).getFullYear() >= 2026, "server overrides a spoofed updated_at");
  check(res.json?.[0]?.warmup?.[0]?.text === "Band pull-aparts", "exercise jsonb round-trips");

  res = await call("POST", "/rest/v1/workout_days?on_conflict=user_id,day", {
    token: a.token,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { ...day, user_id: a.id, main_notes: "edited" },
  });
  check((res.status === 200 || res.status === 201) && res.json?.[0]?.main_notes === "edited", "re-sending the same day updates it (merge-duplicates)", `(${res.status} ${res.text.slice(0, 200)})`);

  res = await call("GET", "/rest/v1/workout_days", { token: a.token });
  check(res.status === 200 && res.json?.length === 1, "A reads exactly their own day");
  const cursor = res.json?.[0]?.updated_at ?? "";

  res = await call("GET", `/rest/v1/workout_days?updated_at=gt.${encodeURIComponent(cursor)}&order=updated_at.asc`, { token: a.token });
  check(res.status === 200 && res.json?.length === 0, "sync pull query (updated_at > cursor) returns only newer rows");

  // B must see nothing and be able to change nothing.
  res = await call("GET", "/rest/v1/workout_days", { token: b.token });
  check(res.status === 200 && res.json?.length === 0, "B reads none of A's days");

  res = await call("POST", "/rest/v1/workout_days", { token: b.token, body: { ...day, user_id: a.id, day: "2026-10-02" } });
  check(res.status === 401 || res.status === 403, "B cannot insert a row owned by A", `(${res.status})`);

  res = await call("PATCH", `/rest/v1/workout_days?user_id=eq.${a.id}`, {
    token: b.token, headers: { Prefer: "return=representation" }, body: { main_notes: "hacked" },
  });
  check(res.status === 200 && res.json?.length === 0, "B's update of A's rows matches nothing");

  res = await call("DELETE", `/rest/v1/workout_days?user_id=eq.${a.id}`, { token: b.token, headers: { Prefer: "return=representation" } });
  check(res.status === 200 && res.json?.length === 0, "B's delete of A's rows matches nothing");

  res = await call("GET", "/rest/v1/workout_days", { token: a.token });
  check(res.json?.[0]?.main_notes === "edited", "A's row survived B's attempts unchanged");

  // Anonymous callers get nothing.
  res = await call("GET", "/rest/v1/workout_days");
  check(res.status === 401 || res.status === 403, "anon key alone cannot read workout_days", `(${res.status})`);

  // Billing state: readable, never writable by the user.
  res = await call("POST", "/rest/v1/subscriptions", { token: a.token, body: { user_id: a.id, plan: "pro", status: "active" } });
  check(res.status === 401 || res.status === 403, "A cannot grant themselves Pro through the API", `(${res.status})`);
  res = await call("GET", "/rest/v1/subscriptions", { token: a.token });
  check(res.status === 200 && res.json?.length === 0, "A can query subscriptions (empty until the server writes one)");

  // Row limit: A is a Free account (cap 1,000 live days). Fill it to the cap with a bulk insert (server side),
  // then the browser path is refused.
  const fill = Array.from({ length: 999 }, (_, i) => ({
    user_id: a.id,
    day: new Date(Date.UTC(2001, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    session_type: "gym",
  }));
  res = await call("POST", "/rest/v1/workout_days", { token: SERVICE, apikey: SERVICE, headers: { Prefer: "return=minimal" }, body: fill });
  check(res.status === 201, "service role bulk-inserts up to the Free cap", `(${res.status} ${res.text.slice(0, 120)})`);
  res = await call("POST", "/rest/v1/workout_days", { token: a.token, body: { ...day, user_id: a.id, day: "2026-12-31" } });
  check(res.status === 422 && res.json?.code === "PT422", "a new day beyond the Free cap is refused as HTTP 422 with code PT422", `(${res.status} ${res.text.slice(0, 160)})`);
  check(/row limit reached for workout_days: at most 1000/.test(res.json?.message ?? ""), "and the message names the table and the Free limit");
  check(/upgrade to Pro/.test(res.json?.hint ?? ""), "and the hint points a Free account to Pro", res.json?.hint);
  res = await call("POST", "/rest/v1/workout_days?on_conflict=user_id,day", {
    token: a.token, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: { ...day, user_id: a.id, main_notes: "still editable at the cap" },
  });
  check((res.status === 200 || res.status === 201) && res.json?.[0]?.main_notes === "still editable at the cap", "editing an existing day at the cap still works");

  // Upgrading lifts the cap immediately (what the Stripe webhook does).
  res = await call("POST", "/rest/v1/subscriptions?on_conflict=user_id", {
    token: SERVICE, apikey: SERVICE, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { user_id: a.id, plan: "pro", status: "active" },
  });
  check([200, 201, 204].includes(res.status), "A is upgraded to Pro", `(${res.status})`);
  res = await call("POST", "/rest/v1/workout_days", { token: a.token, headers: { Prefer: "return=minimal" }, body: { ...day, user_id: a.id, day: "2026-12-31" } });
  check(res.status === 201, "after the upgrade the same new day is accepted", `(${res.status} ${res.text.slice(0, 120)})`);
  res = await call("POST", "/rest/v1/subscriptions?on_conflict=user_id", {
    token: SERVICE, apikey: SERVICE, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { user_id: a.id, plan: "free", status: "canceled" },
  });
  check([200, 201, 204].includes(res.status), "A drops back to Free (subscription canceled)", `(${res.status})`);

  // Service role (server only) bypasses RLS.
  res = await call("GET", `/rest/v1/workout_days?user_id=eq.${a.id}&day=eq.2026-10-01`, { token: SERVICE, apikey: SERVICE });
  check(res.status === 200 && res.json?.length === 1, "service role can read across users (server-side only)");

  // Billing: real signed Stripe webhooks -> API -> Postgres (subscriptions + stripe_events), then the user-facing endpoint.
  const API = `http://localhost:${env.GYM_API_PORT ?? 3010}`;
  const tag = Date.now();
  const customer = `cus_smoke_${tag}`;
  const webhook = async (id, type, object) => {
    const raw = JSON.stringify({ id, type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`, "utf8").digest("hex");
    const r = await fetch(`${API}/api/stripe-webhook`, { method: "POST", headers: { "stripe-signature": `t=${t},v1=${v1}`, "Content-Type": "application/json" }, body: raw });
    return r.status;
  };
  const subscriptionRow = async () => (await call("GET", `/rest/v1/subscriptions?user_id=eq.${a.id}`, { token: SERVICE, apikey: SERVICE })).json?.[0];

  check((await webhook(`evt_smoke_${tag}_1`, "checkout.session.completed", { client_reference_id: a.id, customer })) === 200, "webhook: checkout completed is accepted");
  let row = await subscriptionRow();
  check(row?.plan === "pro" && row?.status === "active" && row?.stripe_customer_id === customer, "webhook: the user becomes Pro and is linked to the Stripe customer in Postgres", JSON.stringify(row));

  res = await fetch(`${API}/api/subscription`, { headers: { Authorization: `Bearer ${a.token}` } });
  const mine = await res.json().catch(() => null);
  check(res.status === 200 && mine?.plan === "pro" && mine?.stripeCustomerId === customer, "GET /api/subscription returns the Pro plan for the signed-in user", JSON.stringify(mine));

  check((await webhook(`evt_smoke_${tag}_2`, "customer.subscription.updated", { customer, status: "canceled", current_period_end: 1893456000 })) === 200, "webhook: a lifecycle event for a known customer is accepted");
  row = await subscriptionRow();
  check(row?.plan === "free" && row?.status === "canceled", "webhook: a canceled subscription drops the user to free", JSON.stringify(row));

  check((await webhook(`evt_smoke_${tag}_2`, "customer.subscription.updated", { customer, status: "active", current_period_end: 1893456000 })) === 200, "webhook: a repeated event id is acknowledged");
  row = await subscriptionRow();
  check(row?.plan === "free", "webhook: and not applied a second time (de-duplicated in Postgres)", JSON.stringify(row));

  check((await webhook(`evt_smoke_${tag}_3`, "customer.subscription.updated", { customer: "cus_unknown", status: "active" })) === 200, "webhook: an unknown customer is acknowledged");
  check((await subscriptionRow())?.plan === "free", "webhook: and changes nobody");

  res = await call("GET", `/rest/v1/stripe_events?event_id=like.evt_smoke_${tag}_*`, { token: SERVICE, apikey: SERVICE });
  check(res.status === 200 && res.json?.length === 2, "webhook: applied events are recorded (the ignored unknown-customer one is not)", `(${res.text.slice(0, 120)})`);
  res = await call("GET", "/rest/v1/stripe_events", { token: a.token });
  check(res.status === 401 || res.status === 403, "a signed-in user cannot read webhook events", `(${res.status})`);
  await call("DELETE", `/rest/v1/stripe_events?event_id=like.evt_smoke_${tag}_*`, { token: SERVICE, apikey: SERVICE });

  // AI settings: the provider choice lives in user_settings.ai_provider (Postgres), written by the API with the service role.
  const settingsRow = async () => (await call("GET", `/rest/v1/user_settings?user_id=eq.${a.id}`, { token: SERVICE, apikey: SERVICE })).json?.[0];
  const api = (method, body) => fetch(`${API}/api/user-settings`, {
    method, headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  res = await api("GET");
  check(res.status === 200 && (await res.json()).aiProvider === "google", "AI settings: a new user gets the default provider");
  res = await api("PUT", { aiProvider: "google" });
  check(res.status === 200, "AI settings: choosing the default provider is accepted");
  check((await settingsRow())?.ai_provider === "google", "AI settings: and stored in Postgres (user_settings.ai_provider)");
  res = await api("PUT", { aiProvider: "skynet" });
  check(res.status === 400, "AI settings: an unknown provider is refused");
  res = await api("PUT", { aiProvider: "anthropic" });
  check(res.status === 402 || res.status === 400, "AI settings: a free user cannot save a Pro provider through the API", `(${res.status})`);
  check((await settingsRow())?.ai_provider === "google", "AI settings: and the stored choice is unchanged");

  // The browser syncs its own columns of the same row; that must not erase the provider.
  res = await call("POST", "/rest/v1/user_settings?on_conflict=user_id", {
    token: a.token, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: { user_id: a.id, active_plan_id: "plan-smoke" },
  });
  check(res.status === 200 || res.status === 201, "AI settings: the browser can sync its own settings columns", `(${res.status} ${res.text.slice(0, 120)})`);
  check((await settingsRow())?.ai_provider === "google" && (await settingsRow())?.active_plan_id === "plan-smoke", "AI settings: and doing so keeps the provider (and the plan) intact");

  // The column is writable by its owner, so the Pro rule must hold at use time: a free user who writes a Pro provider
  // straight into their row still sees, and gets, the default.
  res = await call("PATCH", `/rest/v1/user_settings?user_id=eq.${a.id}`, { token: a.token, headers: { Prefer: "return=minimal" }, body: { ai_provider: "anthropic" } });
  check(res.status === 204 || res.status === 200, "AI settings: a user can write their own row directly (so the API cannot be the only gate)", `(${res.status})`);
  res = await api("GET");
  check((await res.json()).aiProvider === "google", "AI settings: but a free user is still reported (and served) the default provider");

  // Rate limiting: counted in Postgres (rate_events), shared by every server instance, with limits that depend on the plan.
  const gen = (n) => fetch(`${API}/api/generate-plan`, {
    method: "POST",
    // A distinct forwarded-for per call keeps the in-memory per-IP burst limit out of the way; this checks the per-user limit.
    headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json", "x-forwarded-for": `10.9.${tag % 250}.${n}` },
    body: JSON.stringify({}),
  });
  const eventCount = async () =>
    (await call("GET", `/rest/v1/rate_events?user_id=eq.${a.id}&route=eq.generate-plan`, { token: SERVICE, apikey: SERVICE })).json?.length;

  // Free: 1 plan per rolling day.
  const freeFirst = await gen(1);
  const freeSecond = await gen(2);
  const freeBody = await freeSecond.json().catch(() => ({}));
  check(freeFirst.status === 400, "plan limits: a free account's first call of the day is let through (then rejected as a bad request)", `(${freeFirst.status})`);
  check(freeSecond.status === 429 && freeBody.plan === "free" && freeBody.retryAfter >= 86390 && freeBody.retryAfter <= 86400,
    "plan limits: a free account's second call is refused with an exact wait of about a day", `(${freeSecond.status} ${JSON.stringify(freeBody)})`);
  check(/Free plan includes 1 AI plan per day/.test(freeBody.error ?? ""), "plan limits: and the message says what Free includes");
  check((await eventCount()) === 1, "plan limits: only the allowed call is recorded");

  // Upgrade to Pro (what the Stripe webhook does) and the allowance becomes 10 per hour.
  res = await call("POST", "/rest/v1/subscriptions?on_conflict=user_id", {
    token: SERVICE, apikey: SERVICE, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { user_id: a.id, plan: "pro", status: "active" },
  });
  check(res.status === 201 || res.status === 204 || res.status === 200, "plan limits: the account is upgraded to Pro", `(${res.status} ${res.text.slice(0, 100)})`);
  const proStatuses = [];
  let proLast;
  for (let n = 3; n <= 12; n += 1) {
    proLast = await gen(n);
    proStatuses.push(proLast.status);
  }
  // One call is already inside the hour, so a Pro account has 9 left before the 10th is refused.
  check(proStatuses.slice(0, 9).every((x) => x === 400) && proStatuses[9] === 429, "plan limits: a Pro account gets 10 per hour (9 more after the one already used, then refused)", proStatuses.join(","));
  const proBody = await proLast.json().catch(() => ({}));
  check(proBody.plan === "pro" && proBody.retryAfter > 0 && proBody.retryAfter <= 3600 && !/Upgrade|Pro allows/.test(proBody.error ?? ""),
    "plan limits: and a Pro account is not pitched an upgrade", JSON.stringify(proBody));
  check((await eventCount()) === 10, "plan limits: 10 allowed calls recorded in total, none for refused ones");

  res = await call("POST", "/rest/v1/rpc/consume_rate_limit", { token: a.token, body: { p_user: a.id, p_route: "x", p_max: 1000, p_window_seconds: 60 } });
  check(res.status === 401 || res.status === 403, "rate limit: a signed-in user cannot call the limiter to hand themselves allowance", `(${res.status})`);
  res = await call("GET", "/rest/v1/rate_events", { token: a.token });
  check(res.status === 401 || res.status === 403, "rate limit: and cannot read the rate events", `(${res.status})`);
  res = await call("POST", "/rest/v1/rpc/consume_rate_limit", { token: SERVICE, apikey: SERVICE, body: { p_user: a.id, p_route: "svc", p_max: 1, p_window_seconds: 60 } });
  check(res.status === 200 && res.json?.[0]?.allowed === true, "rate limit: the server (service role) can use it", `(${res.status} ${res.text.slice(0, 100)})`);
} finally {
  for (const id of ids) {
    await call("DELETE", `/auth/v1/admin/users/${id}`, { token: SERVICE, apikey: SERVICE });
  }
  const left = await call("GET", `/rest/v1/workout_days?user_id=in.(${ids.join(",")})`, { token: SERVICE, apikey: SERVICE });
  check(left.status === 200 && left.json?.length === 0, "deleting the users cascaded to their data");
}

console.log(failures === 0 ? "\nSMOKE TESTS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
