import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getStripeCustomerUserId,
  getSubscription,
  hasProAccess,
  isStripeEventProcessed,
  markStripeEventProcessed,
  setSubscription,
  setStoreSubscription,
  getStoreSubscriptionUser,
} from "./subscriptionGuard";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the slice of the Supabase client the store uses. */
class FakeDb {
  public tables: Record<string, Row[]> = { subscriptions: [], stripe_events: [] };
  public failWith: string | null = null;
  public lastUpsert: { row: Row; options: Row } | null = null;

  public from(table: string) {
    const rows = this.tables[table];
    const fail = () => (this.failWith ? { data: null, error: { message: this.failWith } } : null);
    return {
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          maybeSingle: async () =>
            fail() ?? { data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null },
        };
        return query;
      },
      upsert: async (row: Row, options: Row) => {
        this.lastUpsert = { row, options };
        const failed = fail();
        if (failed) return { error: failed.error };
        const key = String(options.onConflict);
        const at = rows.findIndex((r) => r[key] === row[key]);
        if (at >= 0) {
          if (options.ignoreDuplicates !== true) rows[at] = { ...rows[at], ...row };
        } else {
          rows.push(row);
        }
        return { error: null };
      },
    };
  }
}

const asClient = (db: FakeDb) => db as unknown as SupabaseClient;

describe("subscription store (Postgres)", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads no row as the free plan", async () => {
    expect(await getSubscription("u1", asClient(db))).toEqual({
      plan: "free",
      status: "inactive",
      stripeCustomerId: null,
      currentPeriodEnd: null,
      source: null,
    });
  });

  it("maps a row to the subscription the app uses", async () => {
    db.tables.subscriptions.push({
      user_id: "u1",
      plan: "pro",
      status: "active",
      stripe_customer_id: "cus_1",
      current_period_end: "2030-01-01T00:00:00.000Z",
    });
    expect(await getSubscription("u1", asClient(db))).toEqual({
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_1",
      currentPeriodEnd: "2030-01-01T00:00:00.000Z",
      source: "stripe", // a row from before the column existed: a Stripe customer means Stripe
    });
  });

  it("reports a store subscription as billed by that store", async () => {
    db.tables.subscriptions.push({
      user_id: "u1",
      plan: "pro",
      status: "active",
      stripe_customer_id: null,
      current_period_end: "2030-01-01T00:00:00.000Z",
      billing_source: "google",
    });
    expect((await getSubscription("u1", asClient(db))).source).toBe("google");
  });

  it("saves a store subscription without touching the Stripe customer", async () => {
    db.tables.subscriptions.push({ user_id: "u1", plan: "free", status: "canceled", stripe_customer_id: "cus_1", billing_source: "stripe" });
    await setStoreSubscription("u1", "apple", "orig-1", { plan: "pro", status: "active", currentPeriodEnd: "2030-01-01T00:00:00.000Z" }, asClient(db));
    expect(db.tables.subscriptions).toHaveLength(1);
    expect(db.tables.subscriptions[0]).toMatchObject({
      plan: "pro",
      status: "active",
      stripe_customer_id: "cus_1",
      billing_source: "apple",
      store_transaction_id: "orig-1",
    });
  });

  it("finds the user a store purchase belongs to, by platform and id", async () => {
    db.tables.subscriptions.push({ user_id: "u1", billing_source: "apple", store_transaction_id: "orig-1" });
    expect(await getStoreSubscriptionUser("apple", "orig-1", asClient(db))).toBe("u1");
    expect(await getStoreSubscriptionUser("google", "orig-1", asClient(db))).toBeNull();
    db.failWith = "timeout";
    await expect(getStoreSubscriptionUser("apple", "orig-1", asClient(db))).rejects.toThrow(/timeout/);
  });

  it("only writes billing_source when it is known, so other saves leave it alone", async () => {
    await setSubscription("u1", { plan: "pro", status: "active", stripeCustomerId: "cus_1", currentPeriodEnd: null }, asClient(db));
    expect(db.lastUpsert?.row).not.toHaveProperty("billing_source");
    await setSubscription("u1", { plan: "pro", status: "active", stripeCustomerId: "cus_1", currentPeriodEnd: null, source: "stripe" }, asClient(db));
    expect(db.lastUpsert?.row).toMatchObject({ billing_source: "stripe" });
  });

  it("fails open to free when the database cannot be read", async () => {
    db.failWith = "connection refused";
    expect((await getSubscription("u1", asClient(db))).plan).toBe("free");
  });

  it("saves a subscription as one row per user and updates it in place", async () => {
    await setSubscription("u1", { plan: "pro", status: "active", stripeCustomerId: "cus_1", currentPeriodEnd: null }, asClient(db));
    await setSubscription("u1", { plan: "free", status: "canceled", stripeCustomerId: "cus_1", currentPeriodEnd: null }, asClient(db));

    expect(db.lastUpsert?.options).toEqual({ onConflict: "user_id" });
    expect(db.tables.subscriptions).toHaveLength(1);
    expect(db.tables.subscriptions[0]).toMatchObject({ user_id: "u1", plan: "free", status: "canceled", stripe_customer_id: "cus_1" });
  });

  it("throws when a subscription cannot be saved, so the webhook answers 5xx and Stripe retries", async () => {
    db.failWith = "disk full";
    await expect(
      setSubscription("u1", { plan: "pro", status: "active", stripeCustomerId: null, currentPeriodEnd: null }, asClient(db))
    ).rejects.toThrow(/disk full/);
  });

  it("finds the user from a Stripe customer, and returns null for an unknown one", async () => {
    db.tables.subscriptions.push({ user_id: "u1", stripe_customer_id: "cus_1" });
    expect(await getStripeCustomerUserId("cus_1", asClient(db))).toBe("u1");
    expect(await getStripeCustomerUserId("cus_other", asClient(db))).toBeNull();
  });

  it("does not turn a database failure into 'unknown customer' (which would drop the event)", async () => {
    db.failWith = "timeout";
    await expect(getStripeCustomerUserId("cus_1", asClient(db))).rejects.toThrow(/timeout/);
  });

  it("remembers processed events, and recording the same id twice is harmless", async () => {
    expect(await isStripeEventProcessed("evt_1", asClient(db))).toBe(false);
    await markStripeEventProcessed("evt_1", asClient(db));
    await markStripeEventProcessed("evt_1", asClient(db));
    expect(await isStripeEventProcessed("evt_1", asClient(db))).toBe(true);
    expect(db.tables.stripe_events).toHaveLength(1);
  });

  it("treats an unreadable event log as 'not processed' and never throws when recording", async () => {
    db.failWith = "unavailable";
    expect(await isStripeEventProcessed("evt_1", asClient(db))).toBe(false);
    await expect(markStripeEventProcessed("evt_1", asClient(db))).resolves.toBeUndefined();
  });
});

describe("hasProAccess", () => {
  const base = { plan: "pro" as const, stripeCustomerId: null, currentPeriodEnd: null };
  it("grants Pro only for an active or trialing Pro plan", () => {
    expect(hasProAccess({ ...base, status: "active" })).toBe(true);
    expect(hasProAccess({ ...base, status: "trialing" })).toBe(true);
    expect(hasProAccess({ ...base, status: "past_due" })).toBe(false);
    expect(hasProAccess({ ...base, plan: "free" as never, status: "active" })).toBe(false);
  });
});
