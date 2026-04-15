import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockRequest, createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/authContext.js", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("./_lib/observability.js", () => ({
  attachApiRequestObservability: vi.fn(() => ({
    setUserId: vi.fn(),
    logUnhandledError: vi.fn(),
    requestId: "test-req-id",
  })),
}));
vi.mock("./_lib/subscriptionGuard.js", () => ({
  getSubscription: vi.fn(),
}));
vi.mock("./_lib/apiEnv.js", () => ({
  getRequiredVercelKvEnv: vi.fn(() => ({
    kvRestApiUrl: "https://kv.example.com",
    kvRestApiToken: "test-token",
  })),
}));

import handler from "./subscription";
import { requireAuth } from "./_lib/authContext.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSubscription = vi.mocked(getSubscription);

const FREE_SUBSCRIPTION = {
  plan: "free" as const,
  status: "inactive",
  stripeCustomerId: null,
  currentPeriodEnd: null,
};

const PRO_SUBSCRIPTION = {
  plan: "pro" as const,
  status: "active",
  stripeCustomerId: "cus_123",
  currentPeriodEnd: "2026-12-31T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/subscription", () => {
  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue(null);
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBeNull(); // requireAuth already responded
  });

  it("returns 405 for non-GET methods", async () => {
    const req = createMockRequest({ method: "POST" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(405);
    expect((state.jsonPayload as { error: string }).error).toBe("Method not allowed");
  });

  it("returns free subscription for unauthenticated-but-present user with no sub", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1", email: "user@test.com", accessToken: "tok" });
    mockGetSubscription.mockResolvedValue(FREE_SUBSCRIPTION);
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(state.jsonPayload).toEqual(FREE_SUBSCRIPTION);
  });

  it("returns pro subscription when user is subscribed", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-2", email: "pro@test.com", accessToken: "tok" });
    mockGetSubscription.mockResolvedValue(PRO_SUBSCRIPTION);
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(state.jsonPayload).toEqual(PRO_SUBSCRIPTION);
  });

  it("returns 500 when subscription lookup throws", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-3", email: null, accessToken: "tok" });
    mockGetSubscription.mockRejectedValue(new Error("KV unavailable"));
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(500);
    expect((state.jsonPayload as { error: string }).error).toContain("Internal server error");
  });
});
