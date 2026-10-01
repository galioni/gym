#!/usr/bin/env node
/**
 * One-off cleanup of the leftover keys in the Upstash KV store (Phase 15).
 *
 *   Dry run (default, changes nothing): lists key groups with counts.
 *     KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/ops/kv-cleanup.mjs
 *
 *   Delete chosen groups:
 *     KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/ops/kv-cleanup.mjs --delete=sync,subscription --yes
 *
 * Get the URL and token from the Upstash console (Vercel > Storage > your KV store > REST API). They are read from the
 * environment only and are never printed. Key names contain user ids, so only a shortened sample is shown; values are
 * never read.
 *
 * Safety: the `ratelimit` group is in use by the API until rate limiting moves to Postgres, so this tool refuses to delete
 * it, and it only deletes groups it knows are leftovers.
 */
const LEFTOVER_GROUPS = new Set([
  "sync", // legacy cloud sync documents
  "subscription", // billing state, now in Postgres
  "stripe_customer", // Stripe customer -> user mapping, now in Postgres
  "stripe_event", // webhook de-duplication, now in Postgres
  "user_settings", // AI provider choice, now in Postgres
  "push_sub", // push notifications (feature removed)
  "push_subscribers",
  "push_sent",
]);
const PROTECTED_GROUPS = new Set(["ratelimit"]);

const url = process.env.KV_REST_API_URL?.replace(/\/+$/, "");
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN (from the Upstash console) in the environment for this command.");
  process.exit(2);
}

const args = process.argv.slice(2);
const deleteArg = args.find((a) => a.startsWith("--delete="));
const confirmed = args.includes("--yes");
const toDelete = deleteArg ? deleteArg.slice("--delete=".length).split(",").map((s) => s.trim()).filter(Boolean) : [];

async function command(parts) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
  });
  if (!response.ok) throw new Error(`KV request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`KV error: ${body.error}`);
  return body.result;
}

async function pipeline(commands) {
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`KV pipeline failed: HTTP ${response.status}`);
  const results = await response.json();
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`KV error: ${failed.error}`);
  return results;
}

const groupOf = (key) => (key.includes(":") ? key.slice(0, key.indexOf(":")) : key);
const shorten = (key) => key.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => `${id.slice(0, 8)}…`);

async function scanAll() {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await command(["SCAN", cursor, "COUNT", "500"]);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== "0");
  return [...new Set(keys)];
}

for (const group of toDelete) {
  if (PROTECTED_GROUPS.has(group)) {
    console.error(`Refusing to delete "${group}": the API still uses it.`);
    process.exit(2);
  }
  if (!LEFTOVER_GROUPS.has(group)) {
    console.error(`Unknown group "${group}". Known leftovers: ${[...LEFTOVER_GROUPS].join(", ")}`);
    process.exit(2);
  }
}

const keys = await scanAll();
const groups = new Map();
for (const key of keys) {
  const g = groupOf(key);
  groups.set(g, [...(groups.get(g) ?? []), key]);
}

console.log(`${keys.length} keys in the store\n`);
console.log("group".padEnd(20), "keys".padStart(6), "  status          sample");
for (const [group, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const status = PROTECTED_GROUPS.has(group) ? "IN USE (kept)" : LEFTOVER_GROUPS.has(group) ? "leftover" : "UNKNOWN (kept)";
  console.log(group.padEnd(20), String(list.length).padStart(6), " ", status.padEnd(15), shorten(list[0]));
}

if (toDelete.length === 0) {
  console.log("\nDry run: nothing deleted. To delete groups, add --delete=<group,group> --yes");
  process.exit(0);
}
if (!confirmed) {
  console.log(`\nWould delete: ${toDelete.join(", ")}. Add --yes to do it.`);
  process.exit(0);
}

let removed = 0;
for (const group of toDelete) {
  const list = groups.get(group) ?? [];
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    await pipeline(batch.map((key) => ["DEL", key]));
    removed += batch.length;
  }
  console.log(`deleted ${list.length} key(s) in "${group}"`);
}
const left = (await scanAll()).filter((k) => toDelete.includes(groupOf(k)));
console.log(`\nDone: ${removed} key(s) removed; ${left.length} remaining in the chosen groups.`);
process.exit(left.length === 0 ? 0 : 1);
