import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/** Who bills the subscription, and so where the person manages it. */
export type BillingSource = "stripe" | "apple" | "google";

export interface SubscriptionInfo {
  plan: "free" | "pro";
  status: string;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
  /** Null for someone who has never subscribed. */
  source?: BillingSource | null;
}

const FREE: SubscriptionInfo = {
  plan: "free",
  status: "inactive",
  stripeCustomerId: null,
  currentPeriodEnd: null,
  source: null,
};

interface SubscriptionRow {
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  current_period_end: string | null;
  billing_source: string | null;
}

function toSource(value: string | null, stripeCustomerId: string | null): BillingSource | null {
  if (value === "stripe" || value === "apple" || value === "google") return value;
  // Rows written before the column existed (or by older code) carry a Stripe customer and no source.
  return stripeCustomerId ? "stripe" : null;
}

/** Full Pro access: active or trialing subscription. */
export function hasProAccess(subscription: SubscriptionInfo): boolean {
  return (
    subscription.plan === "pro" &&
    (subscription.status === "active" || subscription.status === "trialing")
  );
}

function fromRow(row: SubscriptionRow): SubscriptionInfo {
  return {
    plan: row.plan === "pro" ? "pro" : "free",
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    currentPeriodEnd: row.current_period_end,
    source: toSource(row.billing_source, row.stripe_customer_id),
  };
}

/**
 * Reads a user's subscription (table `subscriptions`; no row means free). Fails open to free if the database cannot
 * be reached, so an outage never locks anyone out of the app, at the cost of a paying user briefly seeing free.
 */
export async function getSubscription(
  userId: string,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<SubscriptionInfo> {
  try {
    const { data, error } = await db
      .from("subscriptions")
      .select("plan, status, stripe_customer_id, current_period_end, billing_source")
      .eq("user_id", userId)
      .maybeSingle<SubscriptionRow>();
    if (error) throw new Error(error.message);
    return data ? fromRow(data) : FREE;
  } catch (err) {
    console.warn("[subscriptionGuard] Could not read subscription; treating as free", err);
    return FREE;
  }
}

export async function setSubscription(
  userId: string,
  info: SubscriptionInfo,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<void> {
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: info.plan,
      status: info.status,
      stripe_customer_id: info.stripeCustomerId,
      current_period_end: info.currentPeriodEnd,
      // Only written when the caller knows it: an upsert that omits a column leaves it as it was.
      ...(info.source ? { billing_source: info.source } : {}),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(`Could not save subscription: ${error.message}`);
}

/**
 * Saves a store (App Store / Google Play) subscription for a user. The Stripe customer id on the row is left untouched, so
 * someone who once paid on the web and now pays through a store keeps the link to their Stripe customer record.
 */
export async function setStoreSubscription(
  userId: string,
  platform: "apple" | "google",
  transactionId: string,
  info: { plan: "free" | "pro"; status: string; currentPeriodEnd: string | null },
  db: SupabaseClient = getSupabaseAdmin()
): Promise<void> {
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: info.plan,
      status: info.status,
      current_period_end: info.currentPeriodEnd,
      billing_source: platform,
      store_transaction_id: transactionId,
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(`Could not save store subscription: ${error.message}`);
}

/**
 * Finds the user a store purchase is attached to. Throws if the database cannot be read, so a store notification is
 * retried instead of being dropped as "unknown purchase".
 */
export async function getStoreSubscriptionUser(
  platform: "apple" | "google",
  transactionId: string,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<string | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("billing_source", platform)
    .eq("store_transaction_id", transactionId)
    .maybeSingle<{ user_id: string }>();
  if (error) throw new Error(`Could not look up store purchase: ${error.message}`);
  return data?.user_id ?? null;
}

/**
 * Finds the user who owns a Stripe customer. Throws if the database cannot be read: the webhook then answers 5xx and
 * Stripe retries, instead of silently dropping the event as "unknown customer".
 */
export async function getStripeCustomerUserId(
  stripeCustomerId: string,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<string | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle<{ user_id: string }>();
  if (error) throw new Error(`Could not look up Stripe customer: ${error.message}`);
  return data?.user_id ?? null;
}

/**
 * Returns true if this Stripe event ID has already been processed.
 * Fails open (returns false) if the database is unreachable: prefer double-processing (every handler is an
 * idempotent upsert) over silently dropping events.
 */
export async function isStripeEventProcessed(
  eventId: string,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  try {
    const { data, error } = await db.from("stripe_events").select("event_id").eq("event_id", eventId).maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  } catch {
    return false;
  }
}

/**
 * Records an event ID so future duplicate deliveries are detected.
 * Best-effort — failures are logged but do not throw.
 */
export async function markStripeEventProcessed(
  eventId: string,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<void> {
  try {
    const { error } = await db.from("stripe_events").upsert({ event_id: eventId }, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("[subscriptionGuard] Failed to mark stripe event processed", { eventId, err });
  }
}
