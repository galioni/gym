import { RequiredVercelKvEnv } from "./apiEnv.js";

export interface SubscriptionInfo {
  plan: "free" | "pro";
  status: string;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
}

const FREE: SubscriptionInfo = {
  plan: "free",
  status: "inactive",
  stripeCustomerId: null,
  currentPeriodEnd: null,
};

async function kvPipeline(
  kvEnv: RequiredVercelKvEnv,
  commands: unknown[][]
): Promise<unknown[]> {
  const response = await fetch(`${kvEnv.kvRestApiUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvEnv.kvRestApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`KV pipeline failed: ${response.status}`);
  return response.json() as Promise<unknown[]>;
}

export async function getSubscription(
  userId: string,
  kvEnv: RequiredVercelKvEnv
): Promise<SubscriptionInfo> {
  try {
    const results = await kvPipeline(kvEnv, [["GET", `subscription:${userId}`]]);
    const raw = (results[0] as { result: string | null }).result;
    if (!raw) return FREE;
    return JSON.parse(raw) as SubscriptionInfo;
  } catch {
    // Fail open — don't block users if KV is unavailable
    return FREE;
  }
}

export async function setSubscription(
  userId: string,
  info: SubscriptionInfo,
  kvEnv: RequiredVercelKvEnv
): Promise<void> {
  await kvPipeline(kvEnv, [["SET", `subscription:${userId}`, JSON.stringify(info)]]);
}

export async function getStripeCustomerUserId(
  stripeCustomerId: string,
  kvEnv: RequiredVercelKvEnv
): Promise<string | null> {
  try {
    const results = await kvPipeline(kvEnv, [["GET", `stripe_customer:${stripeCustomerId}`]]);
    const raw = (results[0] as { result: string | null }).result;
    return raw ?? null;
  } catch {
    return null;
  }
}

export async function setStripeCustomerMapping(
  stripeCustomerId: string,
  userId: string,
  kvEnv: RequiredVercelKvEnv
): Promise<void> {
  await kvPipeline(kvEnv, [["SET", `stripe_customer:${stripeCustomerId}`, userId]]);
}
