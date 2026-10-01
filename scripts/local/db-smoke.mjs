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

  // Row limit: fill the account to its cap with a bulk insert (server side), then the browser path is refused.
  const fill = Array.from({ length: 4999 }, (_, i) => ({
    user_id: a.id,
    day: new Date(Date.UTC(2001, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    session_type: "gym",
  }));
  res = await call("POST", "/rest/v1/workout_days", { token: SERVICE, apikey: SERVICE, headers: { Prefer: "return=minimal" }, body: fill });
  check(res.status === 201, "service role bulk-inserts up to the cap", `(${res.status} ${res.text.slice(0, 120)})`);
  res = await call("POST", "/rest/v1/workout_days", { token: a.token, body: { ...day, user_id: a.id, day: "2026-12-31" } });
  check(res.status === 422 && res.json?.code === "PT422", "a new day beyond the cap is refused as HTTP 422 with code PT422", `(${res.status} ${res.text.slice(0, 160)})`);
  check(/row limit reached for workout_days/.test(res.json?.message ?? ""), "and the message names the table and limit");
  res = await call("POST", "/rest/v1/workout_days?on_conflict=user_id,day", {
    token: a.token, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: { ...day, user_id: a.id, main_notes: "still editable at the cap" },
  });
  check((res.status === 200 || res.status === 201) && res.json?.[0]?.main_notes === "still editable at the cap", "editing an existing day at the cap still works");

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
} finally {
  for (const id of ids) {
    await call("DELETE", `/auth/v1/admin/users/${id}`, { token: SERVICE, apikey: SERVICE });
  }
  const left = await call("GET", `/rest/v1/workout_days?user_id=in.(${ids.join(",")})`, { token: SERVICE, apikey: SERVICE });
  check(left.status === 200 && left.json?.length === 0, "deleting the users cascaded to their data");
}

console.log(failures === 0 ? "\nSMOKE TESTS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
