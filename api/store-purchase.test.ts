import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/authContext.js", () => ({ requireAuth: vi.fn() }));
vi.mock("./_lib/observability.js", () => ({
  attachApiRequestObservability: vi.fn(() => ({ setUserId: vi.fn(), logUnhandledError: vi.fn(), requestId: "test-req-id" })),
}));
vi.mock("./_lib/storePurchases.js", () => ({
  verifyStorePurchase: vi.fn(),
  isStoreBillingConfigured: vi.fn(),
  STORE_NOT_CONFIGURED: "Subscriptions in the app are not available yet.",
}));

import handler from "./store-purchase";
import { requireAuth } from "./_lib/authContext.js";
import { isStoreBillingConfigured, verifyStorePurchase } from "./_lib/storePurchases.js";

const auth = vi.mocked(requireAuth);
const configured = vi.mocked(isStoreBillingConfigured);
const verify = vi.mocked(verifyStorePurchase);

const SUBSCRIPTION = { plan: "pro" as const, status: "active", stripeCustomerId: null, currentPeriodEnd: "2026-11-03T12:00:00.000Z", source: "apple" as const };

async function call(body: unknown, method = "POST") {
  const { res, state } = createMockResponse();
  await handler(createMockRequest({ method, body }), res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ userId: "u1", email: "a@b.co" } as never);
  configured.mockReturnValue(true);
});

describe("POST /api/store-purchase", () => {
  it("rejects other methods", async () => {
    expect((await call(undefined, "GET")).statusCode).toBe(405);
  });

  it("needs a signed-in user", async () => {
    auth.mockResolvedValue(null);
    await call({ platform: "apple", token: "t" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("validates the platform and the token", async () => {
    for (const body of [{}, { platform: "windows", token: "t" }, { platform: "apple" }, { platform: "apple", token: "" }, { platform: "apple", token: "x".repeat(3000) }]) {
      expect((await call(body)).statusCode).toBe(400);
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("says so, with 503, until store billing is configured", async () => {
    configured.mockReturnValue(false);
    const state = await call({ platform: "google", token: "t" });
    expect(state.statusCode).toBe(503);
    expect(state.jsonPayload).toEqual({ error: "Subscriptions in the app are not available yet." });
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns the account's subscription after a verified purchase, never cached", async () => {
    verify.mockResolvedValue({ ok: true, subscription: SUBSCRIPTION });
    const state = await call({ platform: "apple", token: "t-1" });
    expect(verify).toHaveBeenCalledWith("u1", "apple", "t-1");
    expect(state.statusCode).toBe(200);
    expect(state.jsonPayload).toEqual(SUBSCRIPTION);
    expect(state.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("passes on a refusal with its status and reason", async () => {
    verify.mockResolvedValue({ ok: false, status: 409, error: "Already subscribed on the web." });
    const state = await call({ platform: "apple", token: "t-1" });
    expect(state.statusCode).toBe(409);
    expect(state.jsonPayload).toEqual({ error: "Already subscribed on the web." });
  });

  it("answers 500 with the request id when something unexpected breaks", async () => {
    verify.mockRejectedValue(new Error("db down"));
    const state = await call({ platform: "apple", token: "t-1" });
    expect(state.statusCode).toBe(500);
    expect(state.jsonPayload).toEqual({ error: "Internal server error", requestId: "test-req-id" });
  });
});
