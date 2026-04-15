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
vi.mock("./_lib/subscriptionGuard.js", () => ({
  getSubscription: vi.fn(),
}));
vi.mock("./_lib/apiEnv.js", () => ({
  getRequiredVercelKvEnv: vi.fn(() => ({ kvRestApiUrl: "https://kv.test", kvRestApiToken: "tok" })),
  getRequiredApiEnv: vi.fn((name: string) => `test-${name}`),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        deleteUser: vi.fn(() => Promise.resolve({ error: null })),
      },
    },
  })),
}));

// Mock global fetch for KV pipeline calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import handler from "./delete-account";
import { requireAuth } from "./_lib/authContext.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";
import { createClient } from "@supabase/supabase-js";

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSubscription = vi.mocked(getSubscription);
const mockCreateClient = vi.mocked(createClient);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: KV delete succeeds
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
});

describe("DELETE /api/delete-account", () => {
  it("returns 405 for non-DELETE requests", async () => {
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(405);
  });

  it("returns 200 and calls KV + Supabase delete on success", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-abc", email: "test@test.com", accessToken: "tok" });
    mockGetSubscription.mockResolvedValue({
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_123",
      currentPeriodEnd: null,
    });

    const req = createMockRequest({ method: "DELETE" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect((state.jsonPayload as { ok: boolean }).ok).toBe(true);

    // KV pipeline was called with correct keys including stripe customer
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/pipeline"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("subscription:user-abc"),
      })
    );
    expect(mockFetch.mock.calls[0][1].body).toContain("stripe_customer:cus_123");

    // Supabase admin deleteUser was called
    const supabaseInstance = mockCreateClient.mock.results[0].value;
    expect(supabaseInstance.auth.admin.deleteUser).toHaveBeenCalledWith("user-abc");
  });

  it("skips stripe customer key when subscription has no stripeCustomerId", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-free", email: null, accessToken: "tok" });
    mockGetSubscription.mockResolvedValue({
      plan: "free",
      status: "inactive",
      stripeCustomerId: null,
      currentPeriodEnd: null,
    });

    const req = createMockRequest({ method: "DELETE" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(200);
    expect(mockFetch.mock.calls[0][1].body).not.toContain("stripe_customer:");
  });

  it("returns 500 when Supabase user deletion fails", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-fail", email: null, accessToken: "tok" });
    mockGetSubscription.mockResolvedValue({ plan: "free", status: "inactive", stripeCustomerId: null, currentPeriodEnd: null });

    const supabaseAdmin = {
      auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: { message: "User not found" } }) } },
    };
    mockCreateClient.mockReturnValueOnce(supabaseAdmin as ReturnType<typeof createClient>);

    const req = createMockRequest({ method: "DELETE" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(500);
    expect((state.jsonPayload as { error: string }).error).toContain("deletion failed");
  });
});
