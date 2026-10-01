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
  getAiModel: vi.fn(() => ({ specificationVersion: "v1", provider: "google", modelId: "gemini-2.0-flash" })),
  getAiModelForProvider: vi.fn(() => ({ specificationVersion: "v1", provider: "google", modelId: "gemini-2.0-flash" })),
  getEnabledProviders: vi.fn(() => ["google"]),
}));
vi.mock("./_lib/subscriptionGuard.js", () => ({
  getSubscription: vi.fn(() => Promise.resolve({ plan: "free", status: "inactive", stripeCustomerId: null, currentPeriodEnd: null })),
  hasProAccess: vi.fn(() => false),
}));
vi.mock("./_lib/userSettingsStore.js", () => ({
  getUserSettings: vi.fn(() => Promise.resolve({})),
}));

import handler from "./generate-plan";
import { requireAuth } from "./_lib/authContext.js";
import { checkRateLimit } from "./_lib/rateLimiter.js";
import { hasProAccess } from "./_lib/subscriptionGuard.js";

const mockRequireAuth = vi.mocked(requireAuth);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockHasPro = vi.mocked(hasProAccess);

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

  describe("limits depend on the plan", () => {
    const post = () =>
      createMockRequest({ method: "POST", headers: { "x-forwarded-for": uniqueIp() }, body: VALID_BODY });

    it("allows a free account 1 plan per rolling day", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "free-user", email: null, accessToken: "tok" });
      mockHasPro.mockReturnValue(false);
      const { res } = createMockResponse();
      await handler(post(), res);
      expect(mockCheckRateLimit).toHaveBeenCalledWith("free-user", "generate-plan", 1, 86_400);
    });

    it("allows a Pro account 10 plans per rolling hour", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "pro-user", email: null, accessToken: "tok" });
      mockHasPro.mockReturnValue(true);
      const { res } = createMockResponse();
      await handler(post(), res);
      expect(mockCheckRateLimit).toHaveBeenCalledWith("pro-user", "generate-plan", 10, 3_600);
    });

    it("tells a free account what the Free plan includes and what Pro adds", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "free-user", email: null, accessToken: "tok" });
      mockHasPro.mockReturnValue(false);
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 82_800 });
      const { res, state } = createMockResponse();
      await handler(post(), res);
      expect(state.statusCode).toBe(429);
      expect(state.jsonPayload).toEqual({
        error: "The Free plan includes 1 AI plan per day. Pro allows 10 per hour.",
        retryAfter: 82_800,
        plan: "free",
      });
    });

    it("does not pitch an upgrade to someone who is already on Pro", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "pro-user", email: null, accessToken: "tok" });
      mockHasPro.mockReturnValue(true);
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 600 });
      const { res, state } = createMockResponse();
      await handler(post(), res);
      expect((state.jsonPayload as { error: string; plan: string }).plan).toBe("pro");
      expect((state.jsonPayload as { error: string }).error).not.toMatch(/Upgrade|Pro allows/);
    });
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
