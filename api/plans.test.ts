import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockRequest, createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/authContext.js", () => ({ requireAuth: vi.fn() }));
vi.mock("./_lib/observability.js", () => ({
  attachApiRequestObservability: vi.fn(() => ({
    setUserId: vi.fn(),
    logUnhandledError: vi.fn(),
    requestId: "test-req-id",
  })),
}));
vi.mock("./_lib/rateLimiter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_lib/rateLimiter.js")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 0 })),
  };
});
vi.mock("./_lib/apiEnv.js", () => ({
  getRequiredVercelKvEnv: vi.fn(() => ({ kvRestApiUrl: "https://kv.test", kvRestApiToken: "tok" })),
}));
vi.mock("./_lib/subscriptionGuard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_lib/subscriptionGuard.js")>();
  return {
    ...actual,
    getSubscription: vi.fn(() =>
      Promise.resolve({ plan: "pro", status: "active", stripeCustomerId: null, currentPeriodEnd: null })
    ),
  };
});
vi.mock("./_lib/cloudSyncApiService.js", () => ({
  CloudSyncApiService: vi.fn(function() {
    return {
      getResource: vi.fn().mockResolvedValue({
        version: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        plans: [{ id: "plan-1", label: "My Plan", sessionIds: ["push", "pull"] }],
      }),
      putResource: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));
vi.mock("./_lib/vercelKvCloudDocumentStore.js", () => ({
  VercelKvCloudDocumentStore: vi.fn(function() { return {}; }),
}));

import handler from "./plans";
import { requireAuth } from "./_lib/authContext.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSubscription = vi.mocked(getSubscription);

const PRO_AUTH = { userId: "user-1", email: null, accessToken: "tok" };
const FREE_SUB = { plan: "free" as const, status: "inactive", stripeCustomerId: null, currentPeriodEnd: null };

const VALID_PUT_BODY = {
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
  plans: [{ id: "plan-1", label: "My Plan", sessionIds: ["push", "pull"] }],
};
const PUT_HEADERS = { "x-forwarded-for": "1.2.3.4", "content-type": "application/json" };

let ipCounter = 0;
function uniqueIp() { return `10.3.${Math.floor(++ipCounter / 255)}.${ipCounter % 255}`; }

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/plans", () => {
  it("returns 405 for unsupported methods", async () => {
    const req = createMockRequest({ method: "PATCH", headers: { "x-forwarded-for": uniqueIp() } });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(405);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockImplementation(async (_, r) => {
      r.status(401).json({ error: "Unauthorized" });
      return null;
    });
    const req = createMockRequest({ method: "GET", headers: { "x-forwarded-for": uniqueIp() } });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(401);
  });

  it("returns 402 for GET when plan is free (no grace period)", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    mockGetSubscription.mockResolvedValueOnce(FREE_SUB);
    const req = createMockRequest({ method: "GET", headers: { "x-forwarded-for": uniqueIp() } });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(402);
  });

  it("returns 200 with plans array on GET happy path", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    const req = createMockRequest({ method: "GET", headers: { "x-forwarded-for": uniqueIp() } });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(200);
    expect(Array.isArray((state.jsonPayload as { plans: unknown }).plans)).toBe(true);
  });

  it("returns 404 when no stored plans exist", async () => {
    const { CloudSyncApiService } = await import("./_lib/cloudSyncApiService.js");
    vi.mocked(CloudSyncApiService).mockImplementationOnce(function() {
      return { getResource: vi.fn().mockResolvedValue(null), putResource: vi.fn().mockResolvedValue(undefined) };
    });
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    const req = createMockRequest({ method: "GET", headers: { "x-forwarded-for": uniqueIp() } });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(404);
  });
});

describe("PUT /api/plans", () => {
  it("returns 402 for PUT when plan is free", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    mockGetSubscription.mockResolvedValueOnce(FREE_SUB);
    const req = createMockRequest({ method: "PUT", headers: { ...PUT_HEADERS, "x-forwarded-for": uniqueIp() }, body: VALID_PUT_BODY });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(402);
  });

  it("returns 400 for invalid PUT payload", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    const req = createMockRequest({
      method: "PUT",
      headers: { ...PUT_HEADERS, "x-forwarded-for": uniqueIp() },
      body: { version: 1, updatedAt: "2026-01-01T00:00:00Z" }, // missing "plans"
    });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(400);
    expect((state.jsonPayload as { error: string }).error).toMatch(/Invalid plans payload/);
  });

  it("returns 400 when a plan has an invalid sessionId format", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    const req = createMockRequest({
      method: "PUT",
      headers: { ...PUT_HEADERS, "x-forwarded-for": uniqueIp() },
      // sessionIds must match SESSION_TYPE_KEY_RE — uppercase fails
      body: { version: 1, updatedAt: "2026-01-01T00:00:00Z", plans: [{ id: "p1", label: "X", sessionIds: ["INVALID"] }] },
    });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(400);
  });

  it("returns 415 for PUT without application/json content-type", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    const req = createMockRequest({
      method: "PUT",
      headers: { "x-forwarded-for": uniqueIp(), "content-type": "text/plain" },
      body: VALID_PUT_BODY,
    });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(415);
  });

  it("returns 200 on PUT happy path", async () => {
    mockRequireAuth.mockResolvedValue(PRO_AUTH);
    const req = createMockRequest({ method: "PUT", headers: { ...PUT_HEADERS, "x-forwarded-for": uniqueIp() }, body: VALID_PUT_BODY });
    const { res, state } = createMockResponse();
    await handler(req, res);
    expect(state.statusCode).toBe(200);
    expect((state.jsonPayload as { ok: boolean }).ok).toBe(true);
  });
});
