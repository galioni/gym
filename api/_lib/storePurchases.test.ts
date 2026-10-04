import { describe, expect, it, vi } from "vitest";
import { refreshStorePurchase, verifyStorePurchase, type StoreDeps } from "./storePurchases";
import { StoreLookupError, type StoreSubscriptionState } from "./storeVerification";
import type { SubscriptionInfo } from "./subscriptionGuard";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const USER = "aaaaaaaa-0000-4000-8000-000000000001";

const FREE: SubscriptionInfo = { plan: "free", status: "inactive", stripeCustomerId: null, currentPeriodEnd: null, source: null };
const STRIPE_PRO: SubscriptionInfo = { plan: "pro", status: "active", stripeCustomerId: "cus_1", currentPeriodEnd: "2026-12-01T00:00:00Z", source: "stripe" };

function state(over: Partial<StoreSubscriptionState> = {}): StoreSubscriptionState {
  return {
    platform: "apple",
    transactionId: "orig-1",
    previousTransactionId: null,
    productId: "pro_monthly",
    access: "active",
    expiresAt: "2026-11-03T12:00:00.000Z",
    accountId: USER,
    ...over,
  };
}

function deps(over: Partial<StoreDeps> = {}) {
  const d = {
    lookup: vi.fn().mockResolvedValue(state()),
    getSubscription: vi.fn().mockResolvedValue(FREE),
    getStoreSubscriptionUser: vi.fn().mockResolvedValue(null),
    setStoreSubscription: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  };
  return d as typeof d & StoreDeps;
}

describe("verifyStorePurchase", () => {
  it("links an active purchase to the account and returns the new subscription", async () => {
    const d = deps();
    const result = await verifyStorePurchase(USER, "apple", "t", d);
    expect(result).toEqual({
      ok: true,
      subscription: { plan: "pro", status: "active", stripeCustomerId: null, currentPeriodEnd: "2026-11-03T12:00:00.000Z", source: "apple" },
    });
    expect(d.setStoreSubscription).toHaveBeenCalledWith(USER, "apple", "orig-1", {
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2026-11-03T12:00:00.000Z",
    });
  });

  it("records an expired purchase as Free, so a restore cannot revive it", async () => {
    const d = deps({ lookup: vi.fn().mockResolvedValue(state({ access: "expired", expiresAt: "2026-09-01T00:00:00.000Z" })) });
    const result = await verifyStorePurchase(USER, "apple", "t", d);
    expect(result).toMatchObject({ ok: true, subscription: { plan: "free", status: "expired" } });
  });

  it("keeps Pro through a billing grace period and says so", async () => {
    const d = deps({ lookup: vi.fn().mockResolvedValue(state({ access: "grace" })) });
    expect(await verifyStorePurchase(USER, "apple", "t", d)).toMatchObject({ ok: true, subscription: { plan: "pro", status: "past_due" } });
  });

  it("refuses a purchase made by another account", async () => {
    const d = deps({ lookup: vi.fn().mockResolvedValue(state({ accountId: "bbbbbbbb-0000-4000-8000-000000000002" })) });
    expect(await verifyStorePurchase(USER, "apple", "t", d)).toMatchObject({ ok: false, status: 403 });
    expect(d.setStoreSubscription).not.toHaveBeenCalled();
  });

  it("refuses a purchase that carries no account id at all", async () => {
    const d = deps({ lookup: vi.fn().mockResolvedValue(state({ accountId: null })) });
    expect(await verifyStorePurchase(USER, "apple", "t", d)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a purchase already linked to a different account", async () => {
    const d = deps({ getStoreSubscriptionUser: vi.fn().mockResolvedValue("someone-else") });
    expect(await verifyStorePurchase(USER, "apple", "t", d)).toMatchObject({ ok: false, status: 409 });
    expect(d.setStoreSubscription).not.toHaveBeenCalled();
  });

  it("does not bill twice: an active Stripe subscription blocks a store purchase", async () => {
    const d = deps({ getSubscription: vi.fn().mockResolvedValue(STRIPE_PRO) });
    const result = await verifyStorePurchase(USER, "apple", "t", d);
    expect(result).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("on the web") });
  });

  it("lets someone re-verify or renew in the same store", async () => {
    const d = deps({ getSubscription: vi.fn().mockResolvedValue({ ...STRIPE_PRO, source: "apple", stripeCustomerId: null }) });
    expect(await verifyStorePurchase(USER, "apple", "t", d)).toMatchObject({ ok: true });
  });

  it("lets a lapsed Stripe customer buy in the store", async () => {
    const d = deps({ getSubscription: vi.fn().mockResolvedValue({ ...STRIPE_PRO, plan: "free", status: "canceled" }) });
    expect(await verifyStorePurchase(USER, "apple", "t", d)).toMatchObject({ ok: true });
  });

  it("turns store failures into answers the app can show", async () => {
    const fail = (reason: "not_found" | "unknown_product" | "wrong_app" | "unavailable") =>
      verifyStorePurchase(USER, "apple", "t", deps({ lookup: vi.fn().mockRejectedValue(new StoreLookupError(reason, "x")) }));
    expect(await fail("not_found")).toMatchObject({ ok: false, status: 404 });
    expect(await fail("unknown_product")).toMatchObject({ ok: false, status: 422 });
    expect(await fail("wrong_app")).toMatchObject({ ok: false, status: 422 });
    expect(await fail("unavailable")).toMatchObject({ ok: false, status: 503 });
  });

  it("lets unexpected errors through, so they are logged and answered 500", async () => {
    const d = deps({ lookup: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(verifyStorePurchase(USER, "apple", "t", d)).rejects.toThrow("boom");
  });
});

describe("refreshStorePurchase", () => {
  it("applies the store's current state to the account the purchase is linked to", async () => {
    const d = deps({
      getStoreSubscriptionUser: vi.fn().mockResolvedValue(USER),
      lookup: vi.fn().mockResolvedValue(state({ access: "expired", expiresAt: "2026-10-01T00:00:00.000Z" })),
    });
    expect(await refreshStorePurchase("apple", "orig-1", d)).toBe(true);
    expect(d.setStoreSubscription).toHaveBeenCalledWith(USER, "apple", "orig-1", { plan: "free", status: "expired", currentPeriodEnd: "2026-10-01T00:00:00.000Z" });
  });

  it("ignores a purchase nobody has linked yet", async () => {
    const d = deps();
    expect(await refreshStorePurchase("apple", "orig-1", d)).toBe(false);
    expect(d.setStoreSubscription).not.toHaveBeenCalled();
  });

  it("follows a Google token that replaced an earlier one", async () => {
    const d = deps({
      lookup: vi.fn().mockResolvedValue(state({ platform: "google", transactionId: "new", previousTransactionId: "old" })),
      getStoreSubscriptionUser: vi.fn(async (_p: string, id: string) => (id === "old" ? USER : null)),
    });
    expect(await refreshStorePurchase("google", "new", d)).toBe(true);
    expect(d.setStoreSubscription).toHaveBeenCalledWith(USER, "google", "new", expect.objectContaining({ plan: "pro" }));
  });

  it("does nothing when the store has no such purchase, and fails (to be retried) when the store is down", async () => {
    expect(await refreshStorePurchase("apple", "x", deps({ lookup: vi.fn().mockRejectedValue(new StoreLookupError("not_found", "x")) }))).toBe(false);
    await expect(
      refreshStorePurchase("apple", "x", deps({ lookup: vi.fn().mockRejectedValue(new StoreLookupError("unavailable", "x")) }))
    ).rejects.toBeInstanceOf(StoreLookupError);
  });

  it("does not move a purchase onto an account it was not made by", async () => {
    const d = deps({
      getStoreSubscriptionUser: vi.fn().mockResolvedValue(USER),
      lookup: vi.fn().mockResolvedValue(state({ accountId: "bbbbbbbb-0000-4000-8000-000000000002" })),
    });
    expect(await refreshStorePurchase("apple", "orig-1", d)).toBe(false);
  });
});
