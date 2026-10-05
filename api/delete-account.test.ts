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
  getRequiredApiEnv: vi.fn((name: string) => `test-${name}`),
}));
vi.mock("./_lib/appleSignIn.js", () => ({
  revokeAppleSignInForUser: vi.fn(() => Promise.resolve("not_configured")),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        deleteUser: vi.fn(() => Promise.resolve({ error: null })),
        getUserById: vi.fn(() =>
          Promise.resolve({ data: { user: { identities: [{ provider: "apple", identity_data: { sub: "apple-sub-1" } }] } }, error: null })
        ),
      },
    },
  })),
}));

import handler from "./delete-account";
import { requireAuth } from "./_lib/authContext.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";
import { createClient } from "@supabase/supabase-js";
import { revokeAppleSignInForUser } from "./_lib/appleSignIn.js";

const mockRevoke = vi.mocked(revokeAppleSignInForUser);
const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSubscription = vi.mocked(getSubscription);
const mockCreateClient = vi.mocked(createClient);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/delete-account", () => {
  it("returns 405 for non-DELETE requests", async () => {
    const req = createMockRequest({ method: "GET" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(405);
  });

  it("returns 200 and deletes the Supabase user on success", async () => {
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

    // Supabase admin deleteUser was called
    const supabaseInstance = mockCreateClient.mock.results[0].value;
    expect(supabaseInstance.auth.admin.deleteUser).toHaveBeenCalledWith("user-abc");
  });

  it("returns 500 when Supabase user deletion fails", async () => {
    mockRequireAuth.mockResolvedValue({ userId: "user-fail", email: null, accessToken: "tok" });
    mockGetSubscription.mockResolvedValue({ plan: "free", status: "inactive", stripeCustomerId: null, currentPeriodEnd: null });

    const supabaseAdmin = {
      auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: { message: "User not found" } }) } },
    };
    mockCreateClient.mockReturnValueOnce(supabaseAdmin as unknown as ReturnType<typeof createClient>);

    const req = createMockRequest({ method: "DELETE" });
    const { res, state } = createMockResponse();

    await handler(req, res);

    expect(state.statusCode).toBe(500);
    expect((state.jsonPayload as { error: string }).error).toContain("deletion failed");
  });

  describe("Sign in with Apple", () => {
    const free = { plan: "free" as const, status: "inactive", stripeCustomerId: null, currentPeriodEnd: null };

    it("revokes the person's Apple token before the account is deleted (Apple requires it)", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "user-abc", email: "t@t.com", accessToken: "tok" });
      mockGetSubscription.mockResolvedValue(free);
      mockRevoke.mockResolvedValue("revoked");
      const { res, state } = createMockResponse();

      await handler(createMockRequest({ method: "DELETE" }), res);

      expect(state.statusCode).toBe(200);
      expect(mockRevoke).toHaveBeenCalledWith("user-abc", expect.anything(), { authorizationCode: null, appleUserId: null });
      const deleteUser = mockCreateClient.mock.results[0].value.auth.admin.deleteUser;
      expect(mockRevoke.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
    });

    it("passes on the fresh Apple code the app sends, with the Apple id the account signed in with", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "user-abc", email: "t@t.com", accessToken: "tok" });
      mockGetSubscription.mockResolvedValue(free);
      mockRevoke.mockResolvedValue("revoked");
      const { res, state } = createMockResponse();

      await handler(createMockRequest({ method: "DELETE", body: { appleAuthorizationCode: "fresh-code" } }), res);

      expect(state.statusCode).toBe(200);
      expect(mockRevoke).toHaveBeenCalledWith("user-abc", expect.anything(), { authorizationCode: "fresh-code", appleUserId: "apple-sub-1" });
    });

    it("ignores a code that is not a sensible string", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "user-abc", email: "t@t.com", accessToken: "tok" });
      mockGetSubscription.mockResolvedValue(free);
      mockRevoke.mockResolvedValue("no_token");
      for (const bad of [42, { a: 1 }, "x".repeat(3000)]) {
        mockRevoke.mockClear();
        const { res } = createMockResponse();
        await handler(createMockRequest({ method: "DELETE", body: { appleAuthorizationCode: bad } }), res);
        expect(mockRevoke).toHaveBeenCalledWith("user-abc", expect.anything(), { authorizationCode: null, appleUserId: null });
      }
    });

    it("deletes the account even when the revocation could not be made", async () => {
      mockRequireAuth.mockResolvedValue({ userId: "user-abc", email: "t@t.com", accessToken: "tok" });
      mockGetSubscription.mockResolvedValue(free);
      mockRevoke.mockResolvedValue("failed");
      const { res, state } = createMockResponse();

      await handler(createMockRequest({ method: "DELETE" }), res);

      expect(state.statusCode).toBe(200);
      expect(mockCreateClient.mock.results[0].value.auth.admin.deleteUser).toHaveBeenCalledWith("user-abc");
    });
  });
});
