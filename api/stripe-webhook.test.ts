import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import crypto from "crypto";
import type { IncomingMessage } from "node:http";
import { createMockResponse } from "./_lib/testHelpers";

// ── module mocks ─────────────────────────────────────────────────────────────

vi.mock("./_lib/apiEnv.js", () => ({
  getRequiredVercelKvEnv: vi.fn(() => ({
    kvRestApiUrl: "https://kv.test",
    kvRestApiToken: "test-token",
  })),
  getStripeWebhookSecret: vi.fn(() => TEST_SECRET),
}));

vi.mock("./_lib/subscriptionGuard.js", () => ({
  getStripeCustomerUserId: vi.fn(),
  setStripeCustomerMappingAndSubscription: vi.fn(),
  setSubscription: vi.fn(),
  isStripeEventProcessed: vi.fn(),
  markStripeEventProcessed: vi.fn(),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import handler from "./stripe-webhook";
import {
  getStripeCustomerUserId,
  isStripeEventProcessed,
  markStripeEventProcessed,
  setStripeCustomerMappingAndSubscription,
  setSubscription,
} from "./_lib/subscriptionGuard.js";

const mockGetStripeCustomerUserId = vi.mocked(getStripeCustomerUserId);
const mockSetStripeCustomerMappingAndSubscription = vi.mocked(setStripeCustomerMappingAndSubscription);
const mockSetSubscription = vi.mocked(setSubscription);
const mockIsStripeEventProcessed = vi.mocked(isStripeEventProcessed);
const mockMarkStripeEventProcessed = vi.mocked(markStripeEventProcessed);

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "whsec_test_secret";

function makeSignature(rawBody: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${timestamp}.${rawBody}`;
  const sig = crypto.createHmac("sha256", TEST_SECRET).update(payload, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function makeStaleSignature(rawBody: string): string {
  // Use a timestamp 10 minutes in the past — beyond the 5-minute window
  const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
  const payload = `${timestamp}.${rawBody}`;
  const sig = crypto.createHmac("sha256", TEST_SECRET).update(payload, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function makeRequest(body: string, overrides: { signature?: string; method?: string } = {}): IncomingMessage {
  const signature = overrides.signature ?? makeSignature(body);
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    method: overrides.method ?? "POST",
    headers: { "stripe-signature": signature },
  }) as unknown as IncomingMessage;

  process.nextTick(() => {
    emitter.emit("data", Buffer.from(body, "utf8"));
    emitter.emit("end");
  });

  return req;
}

function stripeEvent(type: string, object: Record<string, unknown>, id = "evt_test_001"): string {
  return JSON.stringify({ id, type, data: { object } });
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsStripeEventProcessed.mockResolvedValue(false);
  mockMarkStripeEventProcessed.mockResolvedValue(undefined);
  mockSetStripeCustomerMappingAndSubscription.mockResolvedValue(undefined);
  mockSetSubscription.mockResolvedValue(undefined);
});

describe("POST /api/stripe-webhook — request validation", () => {
  it("returns 405 for non-POST requests", async () => {
    const body = stripeEvent("checkout.session.completed", {});
    const req = makeRequest(body, { method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(405);
  });

  it("returns 400 when Stripe-Signature header is missing", async () => {
    const emitter = new EventEmitter();
    const req = Object.assign(emitter, {
      method: "POST",
      headers: {},
    }) as unknown as IncomingMessage;
    process.nextTick(() => { emitter.emit("data", Buffer.from("{}")); emitter.emit("end"); });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(400);
    expect((state.jsonPayload as { error: string }).error).toContain("Stripe-Signature");
  });

  it("returns 400 for an invalid signature", async () => {
    const body = stripeEvent("checkout.session.completed", {});
    const req = makeRequest(body, { signature: "t=123456789,v1=deadbeef" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(400);
    expect((state.jsonPayload as { error: string }).error).toContain("Invalid signature");
  });

  it("returns 400 when signature timestamp is older than 5 minutes", async () => {
    const body = stripeEvent("checkout.session.completed", {});
    const req = makeRequest(body, { signature: makeStaleSignature(body) });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(400);
  });

  it("returns 400 for malformed JSON body", async () => {
    const rawBody = "not-json";
    const req = makeRequest(rawBody, { signature: makeSignature(rawBody) });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(400);
    expect((state.jsonPayload as { error: string }).error).toContain("Invalid JSON");
  });
});

describe("POST /api/stripe-webhook — checkout.session.completed", () => {
  it("writes customer mapping and pro subscription to KV", async () => {
    const body = stripeEvent("checkout.session.completed", {
      client_reference_id: "user-abc",
      customer: "cus_123",
      subscription: "sub_456",
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect((state.jsonPayload as { received: boolean }).received).toBe(true);
    expect(mockSetStripeCustomerMappingAndSubscription).toHaveBeenCalledOnce();
    expect(mockSetStripeCustomerMappingAndSubscription).toHaveBeenCalledWith(
      "cus_123",
      "user-abc",
      expect.objectContaining({ plan: "pro", status: "active", stripeCustomerId: "cus_123" }),
      expect.any(Object)
    );
  });

  it("returns 200 without writing KV when client_reference_id is missing", async () => {
    const body = stripeEvent("checkout.session.completed", {
      customer: "cus_123",
      subscription: "sub_456",
      // no client_reference_id
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetStripeCustomerMappingAndSubscription).not.toHaveBeenCalled();
  });

  it("returns 200 without writing KV when customer is missing", async () => {
    const body = stripeEvent("checkout.session.completed", {
      client_reference_id: "user-abc",
      // no customer
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetStripeCustomerMappingAndSubscription).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe-webhook — customer.subscription.updated", () => {
  const PERIOD_END_UNIX = 1893456000; // 2030-01-01
  const PERIOD_END_ISO = new Date(PERIOD_END_UNIX * 1000).toISOString();

  it("writes pro subscription when status is active", async () => {
    mockGetStripeCustomerUserId.mockResolvedValue("user-pro");
    const body = stripeEvent("customer.subscription.updated", {
      customer: "cus_123",
      status: "active",
      current_period_end: PERIOD_END_UNIX,
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetSubscription).toHaveBeenCalledOnce();
    expect(mockSetSubscription).toHaveBeenCalledWith(
      "user-pro",
      expect.objectContaining({
        plan: "pro",
        status: "active",
        stripeCustomerId: "cus_123",
        currentPeriodEnd: PERIOD_END_ISO,
      }),
      expect.any(Object)
    );
  });

  it("writes pro subscription when status is trialing", async () => {
    mockGetStripeCustomerUserId.mockResolvedValue("user-trial");
    const body = stripeEvent("customer.subscription.updated", {
      customer: "cus_456",
      status: "trialing",
      current_period_end: PERIOD_END_UNIX,
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(mockSetSubscription).toHaveBeenCalledWith(
      "user-trial",
      expect.objectContaining({ plan: "pro", status: "trialing" }),
      expect.any(Object)
    );
  });

  it("downgrades to free plan when subscription is canceled", async () => {
    mockGetStripeCustomerUserId.mockResolvedValue("user-lapsed");
    const body = stripeEvent("customer.subscription.updated", {
      customer: "cus_789",
      status: "canceled",
      current_period_end: PERIOD_END_UNIX,
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetSubscription).toHaveBeenCalledWith(
      "user-lapsed",
      expect.objectContaining({ plan: "free", status: "canceled" }),
      expect.any(Object)
    );
  });

  it("returns 200 without writing KV when customer id is missing", async () => {
    const body = stripeEvent("customer.subscription.updated", {
      status: "active",
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetSubscription).not.toHaveBeenCalled();
  });

  it("returns 200 without writing KV when customer has no user mapping", async () => {
    mockGetStripeCustomerUserId.mockResolvedValue(null);
    const body = stripeEvent("customer.subscription.updated", {
      customer: "cus_unknown",
      status: "active",
      current_period_end: PERIOD_END_UNIX,
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetSubscription).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe-webhook — customer.subscription.deleted", () => {
  it("downgrades to free plan on subscription deleted", async () => {
    mockGetStripeCustomerUserId.mockResolvedValue("user-deleted");
    const body = stripeEvent("customer.subscription.deleted", {
      customer: "cus_del",
      status: "canceled",
      current_period_end: null,
    });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetSubscription).toHaveBeenCalledWith(
      "user-deleted",
      expect.objectContaining({ plan: "free", status: "canceled", currentPeriodEnd: null }),
      expect.any(Object)
    );
  });
});

describe("POST /api/stripe-webhook — unknown event types", () => {
  it("ignores unknown event types and returns 200", async () => {
    const body = stripeEvent("payment_intent.created", { id: "pi_test" });
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetSubscription).not.toHaveBeenCalled();
    expect(mockSetStripeCustomerMappingAndSubscription).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe-webhook — idempotency", () => {
  it("returns 200 and skips processing when event was already handled", async () => {
    mockIsStripeEventProcessed.mockResolvedValue(true);

    const body = stripeEvent("checkout.session.completed", {
      client_reference_id: "user-abc",
      customer: "cus_123",
      subscription: "sub_456",
    }, "evt_already_seen");
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect((state.jsonPayload as { received: boolean }).received).toBe(true);
    expect(mockSetStripeCustomerMappingAndSubscription).not.toHaveBeenCalled();
    expect(mockMarkStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("marks event processed after successful checkout.session.completed", async () => {
    mockIsStripeEventProcessed.mockResolvedValue(false);

    const body = stripeEvent("checkout.session.completed", {
      client_reference_id: "user-abc",
      customer: "cus_123",
      subscription: "sub_456",
    }, "evt_new_001");
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockMarkStripeEventProcessed).toHaveBeenCalledWith("evt_new_001", expect.any(Object));
  });

  it("marks event processed after customer.subscription.updated", async () => {
    mockIsStripeEventProcessed.mockResolvedValue(false);
    mockGetStripeCustomerUserId.mockResolvedValue("user-abc");

    const body = stripeEvent("customer.subscription.updated", {
      customer: "cus_123",
      status: "active",
      current_period_end: 1893456000,
    }, "evt_sub_update_001");
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockMarkStripeEventProcessed).toHaveBeenCalledWith("evt_sub_update_001", expect.any(Object));
  });

  it("processes event normally when KV is down (isStripeEventProcessed returns false)", async () => {
    mockIsStripeEventProcessed.mockResolvedValue(false); // KV down, fail open

    const body = stripeEvent("checkout.session.completed", {
      client_reference_id: "user-abc",
      customer: "cus_123",
    }, "evt_kv_down");
    const req = makeRequest(body);
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockSetStripeCustomerMappingAndSubscription).toHaveBeenCalledOnce();
  });
});
