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
  getAiModel: vi.fn(() => ({ specificationVersion: "v1", provider: "google", modelId: "gemini-2.0-flash" })),
  getAiModelForProvider: vi.fn(() => ({ specificationVersion: "v1", provider: "google", modelId: "gemini-2.0-flash" })),
  getEnabledProviders: vi.fn(() => ["google"]),
}));
vi.mock("./_lib/subscriptionGuard.js", () => ({
  getSubscription: vi.fn(() => Promise.resolve({ plan: "free", status: "inactive", stripeCustomerId: null, currentPeriodEnd: null })),
  hasProAccess: vi.fn(() => false),
}));
vi.mock("./_lib/userSettingsKv.js", () => ({
  getUserSettings: vi.fn(() => Promise.resolve({})),
}));

import handler from "./generate-plan";
import { requireAuth } from "./_lib/authContext.js";
import { checkRateLimit } from "./_lib/rateLimiter.js";

const mockRequireAuth = vi.mocked(requireAuth);
const mockCheckRateLimit = vi.mocked(checkRateLimit);

const VALID_BODY = {
  goal: "strength",
  experience: "intermediate",
  daysPerWeek: 4,
  equipment: "full_gym",
  duration: "60",
  bodyFocus: ["chest", "back"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// Each test uses a unique IP to prevent cross-test state leakage from
// the module-level FixedWindowRateLimiter singleton.
let ipCounter = 0;
function uniqueIp() { return `10.0.${Math.floor(++ipCounter / 255)}.${ipCounter % 255}`; }

describe("POST /api/generate-plan", () => {
  it("returns 405 for non-POST requests", async () => {
    const req = createMockRequest({ method: "GET", headers: { "x-forwarded-for": uniqueIp() } });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(405);
  });

  it("returns 400 for invalid body", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1", email: null, accessToken: "tok" });
    const req = createMockRequest({
      method: "POST",
      headers: { "x-forwarded-for": uniqueIp() },
      body: { goal: "invalid_goal", experience: "beginner", daysPerWeek: 3, equipment: "full_gym", duration: "60", bodyFocus: [] },
    });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(400);
    expect((state.jsonPayload as { error: string }).error).toMatch(/Invalid request/);
  });

  it("returns 429 when per-user rate limit is exceeded", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-1", email: null, accessToken: "tok" });
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
    const req = createMockRequest({
      method: "POST",
      headers: { "x-forwarded-for": uniqueIp() },
      body: VALID_BODY,
    });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(429);
    expect((state.jsonPayload as { retryAfter: number }).retryAfter).toBe(30);
  });

  it("blocks at IP limiter before auth when burst threshold exceeded", async () => {
    // The IP limiter allows 5/min per IP. Use a fresh IP and exhaust its budget.
    const ip = uniqueIp();
    let lastState;
    for (let i = 0; i < 6; i++) {
      const req = createMockRequest({
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: VALID_BODY,
      });
      const { res, state } = createMockResponse();
      await handler(req, res);
      lastState = state;
    }
    // 6th request from the same IP should be rejected by the IP limiter
    expect(lastState!.statusCode).toBe(429);
    // requireAuth should have been called for the first 5 (allowed) requests only
    expect(mockRequireAuth).toHaveBeenCalledTimes(5);
  });
});
