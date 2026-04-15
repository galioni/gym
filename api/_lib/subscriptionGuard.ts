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

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Full Pro access: active or trialing subscription. */
export function hasProAccess(subscription: SubscriptionInfo): boolean {
  return (
    subscription.plan === "pro" &&
    (subscription.status === "active" || subscription.status === "trialing")
  );
}

/**
 * Read-only grace period access: allows GET requests for 7 days after
 * currentPeriodEnd so recently-lapsed users can still retrieve their data.
 */
export function hasProReadAccess(subscription: SubscriptionInfo): boolean {
  if (hasProAccess(subscription)) return true;
  if (!subscription.currentPeriodEnd) return false;
  const periodEnd = new Date(subscription.currentPeriodEnd).getTime();
  return Date.now() <= periodEnd + GRACE_PERIOD_MS;
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

function subscriptionTtlSeconds(info: SubscriptionInfo): number {
  const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
  if (info.currentPeriodEnd) {
    const secondsUntilEnd = Math.floor(
      (new Date(info.currentPeriodEnd).getTime() - Date.now()) / 1000
    );
    // Keep the record for 30 days beyond the period end so webhook delays and
    // grace-period checks don't cause a surprise downgrade. Minimum 1 day.
    return Math.max(secondsUntilEnd + THIRTY_DAYS_S, 24 * 60 * 60);
  }
  // No period end (free/inactive) — expire after 30 days; refreshed on next webhook.
  return THIRTY_DAYS_S;
}

export async function setSubscription(
  userId: string,
  info: SubscriptionInfo,
  kvEnv: RequiredVercelKvEnv
): Promise<void> {
  const ttl = subscriptionTtlSeconds(info);
  await kvPipeline(kvEnv, [
    ["SET", `subscription:${userId}`, JSON.stringify(info), "EX", ttl],
  ]);
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

/**
 * Atomically writes both the customer→user mapping and the subscription record
 * in a single KV pipeline round-trip. Use this on checkout.session.completed
 * instead of calling setStripeCustomerMapping + setSubscription separately.
 */
export async function setStripeCustomerMappingAndSubscription(
  stripeCustomerId: string,
  userId: string,
  info: SubscriptionInfo,
  kvEnv: RequiredVercelKvEnv
): Promise<void> {
  const ttl = subscriptionTtlSeconds(info);
  await kvPipeline(kvEnv, [
    ["SET", `stripe_customer:${stripeCustomerId}`, userId],
    ["SET", `subscription:${userId}`, JSON.stringify(info), "EX", ttl],
  ]);
}
