import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/authContext.js", () => ({ requireAuth: vi.fn() }));
vi.mock("./_lib/observability.js", () => ({
  attachApiRequestObservability: vi.fn(() => ({ setUserId: vi.fn(), logUnhandledError: vi.fn(), requestId: "test-req-id" })),
}));
vi.mock("./_lib/apiEnv.js", () => ({ getRequiredApiEnv: vi.fn((name: string) => `test-${name}`) }));
vi.mock("./_lib/appleSignIn.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/appleSignIn.js")>()),
  getAppleSignInConfig: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  saveAppleRefreshToken: vi.fn(),
}));

const getUserById = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ auth: { admin: { getUserById } } })) }));

import handler from "./apple-token";
import { requireAuth } from "./_lib/authContext.js";
import { AppleSignInError, exchangeAuthorizationCode, getAppleSignInConfig, saveAppleRefreshToken } from "./_lib/appleSignIn.js";

const config = { teamId: "T", keyId: "K", privateKey: "p", clientId: "c" };

async function call(body: unknown, method = "POST") {
  const { res, state } = createMockResponse();
  await handler(createMockRequest({ method, body }), res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", email: "a@b.co" } as never);
  vi.mocked(getAppleSignInConfig).mockReturnValue(config);
  getUserById.mockResolvedValue({ data: { user: { identities: [{ provider: "apple", identity_data: { sub: "apple-sub-1" } }] } }, error: null });
  vi.mocked(exchangeAuthorizationCode).mockResolvedValue({ refreshToken: "r-1", appleUserId: "apple-sub-1" });
});

describe("POST /api/apple-token", () => {
  it("only accepts POST, and only from a signed-in user", async () => {
    expect((await call({}, "GET")).statusCode).toBe(405);
    vi.mocked(requireAuth).mockResolvedValue(null);
    await call({ authorizationCode: "c" });
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("validates the code", async () => {
    for (const body of [{}, { authorizationCode: "" }, { authorizationCode: 5 }, { authorizationCode: "x".repeat(3000) }]) {
      expect((await call(body)).statusCode).toBe(400);
    }
  });

  it("answers 503 until Sign in with Apple is configured", async () => {
    vi.mocked(getAppleSignInConfig).mockReturnValue(null);
    expect((await call({ authorizationCode: "c" })).statusCode).toBe(503);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("keeps the refresh token for an account that signed in with Apple", async () => {
    const state = await call({ authorizationCode: "the-code" });
    expect(state.statusCode).toBe(200);
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith("the-code", config);
    expect(saveAppleRefreshToken).toHaveBeenCalledWith("u1", "r-1", expect.anything());
  });

  it("refuses an account that has no Apple identity", async () => {
    getUserById.mockResolvedValue({ data: { user: { identities: [{ provider: "email" }] } }, error: null });
    expect((await call({ authorizationCode: "c" })).statusCode).toBe(403);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("refuses a code issued to a different Apple account", async () => {
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({ refreshToken: "r", appleUserId: "someone-else" });
    expect((await call({ authorizationCode: "c" })).statusCode).toBe(403);
    expect(saveAppleRefreshToken).not.toHaveBeenCalled();
  });

  it("tells the app when Apple did not accept the code, and fails (500) when Apple is down", async () => {
    vi.mocked(exchangeAuthorizationCode).mockRejectedValue(new AppleSignInError("rejected", "bad code"));
    expect((await call({ authorizationCode: "c" })).statusCode).toBe(400);
    vi.mocked(exchangeAuthorizationCode).mockRejectedValue(new AppleSignInError("unavailable", "down"));
    expect((await call({ authorizationCode: "c" })).statusCode).toBe(500);
  });
});
