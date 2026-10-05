import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/authContext.js", () => ({ requireAuth: vi.fn() }));
vi.mock("./_lib/observability.js", () => ({
  attachApiRequestObservability: vi.fn(() => ({ setUserId: vi.fn(), logUnhandledError: vi.fn(), requestId: "test-req-id" })),
}));
vi.mock("./_lib/http.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/http.js")>()),
  isAllowedReturnUrl: vi.fn(() => true),
}));
vi.mock("./_lib/subscriptionGuard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/subscriptionGuard.js")>()),
  getSubscription: vi.fn(),
  setSubscription: vi.fn(),
}));
vi.mock("./_lib/stripeClient.js", () => ({
  createStripeCustomer: vi.fn(async () => ({ id: "cus_new" })),
  createCheckoutSession: vi.fn(async () => ({ url: "https://checkout.example/s" })),
  createBillingPortalSession: vi.fn(async () => ({ url: "https://portal.example/s" })),
}));
vi.mock("./_lib/apiEnv.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/apiEnv.js")>()),
  getStripeProPriceId: vi.fn(() => "price_1"),
}));

import checkout from "./create-checkout-session";
import portal from "./billing-portal";
import { requireAuth } from "./_lib/authContext.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";

const sub = (over: Record<string, unknown>) => ({ plan: "pro", status: "active", stripeCustomerId: null, currentPeriodEnd: null, source: null, ...over }) as never;

async function post(handler: typeof checkout) {
  const { res, state } = createMockResponse();
  await handler(createMockRequest({ method: "POST", body: { successUrl: "https://x/a", cancelUrl: "https://x/b", returnUrl: "https://x/c" } }), res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", email: "a@b.co" } as never);
});

describe("someone subscribed through a store", () => {
  it("cannot start a Stripe checkout on top of it", async () => {
    vi.mocked(getSubscription).mockResolvedValue(sub({ source: "apple" }));
    const state = await post(checkout);
    expect(state.statusCode).toBe(409);
    expect(state.jsonPayload).toEqual({ error: expect.stringContaining("App Store") });
  });

  it("can still check out on the web once the store subscription has lapsed", async () => {
    vi.mocked(getSubscription).mockResolvedValue(sub({ plan: "free", status: "expired", source: "google" }));
    expect((await post(checkout)).statusCode).toBe(200);
  });

  it("is sent to the store's subscription settings instead of a Stripe portal", async () => {
    vi.mocked(getSubscription).mockResolvedValue(sub({ source: "google" }));
    const state = await post(portal as never);
    expect(state.statusCode).toBe(409);
    expect(state.jsonPayload).toEqual({ error: expect.stringContaining("Google Play") });
  });

  it("a web subscriber still gets the Stripe portal", async () => {
    vi.mocked(getSubscription).mockResolvedValue(sub({ stripeCustomerId: "cus_1", source: "stripe" }));
    const state = await post(portal as never);
    expect(state.statusCode).toBe(200);
    expect(state.jsonPayload).toEqual({ url: "https://portal.example/s" });
  });
});
