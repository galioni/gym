import type { RequiredVercelKvEnv } from "./apiEnv.js";

interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  reminderMinuteUtc: number;
}

async function kvExecute(
  env: RequiredVercelKvEnv,
  command: Array<string | number>
): Promise<unknown> {
  const response = await fetch(env.kvRestApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.kvRestApiToken}`,
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    throw new Error(`KV request failed: ${response.status}`);
  }
  const body = await response.json() as { result: unknown };
  return body.result;
}

export async function savePushSubscription(
  env: RequiredVercelKvEnv,
  userId: string,
  record: PushSubscriptionRecord
): Promise<void> {
  await Promise.all([
    kvExecute(env, ["SET", `push_sub:${userId}`, JSON.stringify(record)]),
    kvExecute(env, ["SADD", "push_subscribers", userId]),
  ]);
}

export async function getPushSubscription(
  env: RequiredVercelKvEnv,
  userId: string
): Promise<PushSubscriptionRecord | null> {
  const raw = await kvExecute(env, ["GET", `push_sub:${userId}`]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as PushSubscriptionRecord;
  } catch {
    return null;
  }
}

export async function deletePushSubscription(
  env: RequiredVercelKvEnv,
  userId: string
): Promise<void> {
  await Promise.all([
    kvExecute(env, ["DEL", `push_sub:${userId}`]),
    kvExecute(env, ["SREM", "push_subscribers", userId]),
  ]);
}

export async function getAllSubscriberIds(env: RequiredVercelKvEnv): Promise<string[]> {
  const result = await kvExecute(env, ["SMEMBERS", "push_subscribers"]);
  if (!Array.isArray(result)) return [];
  return result.filter((v): v is string => typeof v === "string");
}

export async function checkAndMarkSent(
  env: RequiredVercelKvEnv,
  userId: string,
  dateStr: string
): Promise<boolean> {
  const key = `push_sent:${userId}:${dateStr}`;
  // SETNX returns 1 if set (first time), 0 if already existed
  const result = await kvExecute(env, ["SET", key, "1", "EX", String(60 * 60 * 48), "NX"]);
  return result === "OK";
}
