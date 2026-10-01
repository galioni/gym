import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/authContext.js", () => ({ requireAuth: vi.fn() }));
vi.mock("./_lib/observability.js", () => ({
  attachApiRequestObservability: vi.fn(() => ({
    setUserId: vi.fn(),
    logUnhandledError: vi.fn(),
    requestId: "test-req-id",
  })),
}));
vi.mock("./_lib/apiEnv.js", () => ({
  getEnabledProviders: vi.fn(() => ["google", "anthropic"]),
}));
vi.mock("./_lib/subscriptionGuard.js", () => ({
  getSubscription: vi.fn(),
  hasProAccess: vi.fn(),
}));
vi.mock("./_lib/userSettingsStore.js", () => ({
  getUserSettings: vi.fn(),
  setAiProvider: vi.fn(),
}));

import handler from "./user-settings";
import { requireAuth } from "./_lib/authContext.js";
import { getSubscription, hasProAccess } from "./_lib/subscriptionGuard.js";
import { getUserSettings, setAiProvider } from "./_lib/userSettingsStore.js";

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSubscription = vi.mocked(getSubscription);
const mockHasPro = vi.mocked(hasProAccess);
const mockGetSettings = vi.mocked(getUserSettings);
const mockSetProvider = vi.mocked(setAiProvider);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: "u1", email: "u@test.com", accessToken: "tok" });
  mockGetSubscription.mockResolvedValue({ plan: "free", status: "inactive", stripeCustomerId: null, currentPeriodEnd: null });
  mockHasPro.mockReturnValue(false);
  mockGetSettings.mockResolvedValue({});
  mockSetProvider.mockResolvedValue(undefined);
});

const put = (body: unknown) => createMockRequest({ method: "PUT", body });

describe("GET /api/user-settings", () => {
  it("reports the default for a user who has never chosen", async () => {
    const { res, state } = createMockResponse();
    await handler(createMockRequest({ method: "GET" }), res);
    expect(state.statusCode).toBe(200);
    expect(state.jsonPayload).toEqual({ aiProvider: "google" });
  });

  it("reports the saved provider for a Pro user", async () => {
    mockHasPro.mockReturnValue(true);
    mockGetSettings.mockResolvedValue({ aiProvider: "anthropic" });
    const { res, state } = createMockResponse();
    await handler(createMockRequest({ method: "GET" }), res);
    expect(state.jsonPayload).toEqual({ aiProvider: "anthropic" });
  });

  it("reports what will really be used: a free user's saved Pro provider shows as the default", async () => {
    mockGetSettings.mockResolvedValue({ aiProvider: "anthropic" });
    const { res, state } = createMockResponse();
    await handler(createMockRequest({ method: "GET" }), res);
    expect(state.jsonPayload).toEqual({ aiProvider: "google" });
  });
});

describe("PUT /api/user-settings", () => {
  it("rejects an unknown provider", async () => {
    const { res, state } = createMockResponse();
    await handler(put({ aiProvider: "skynet" }), res);
    expect(state.statusCode).toBe(400);
    expect(mockSetProvider).not.toHaveBeenCalled();
  });

  it("rejects a provider that is not switched on", async () => {
    const { res, state } = createMockResponse();
    await handler(put({ aiProvider: "openai" }), res);
    expect(state.statusCode).toBe(400);
    expect(mockSetProvider).not.toHaveBeenCalled();
  });

  it("lets anyone choose the default provider", async () => {
    const { res, state } = createMockResponse();
    await handler(put({ aiProvider: "google" }), res);
    expect(state.statusCode).toBe(200);
    expect(mockSetProvider).toHaveBeenCalledWith("u1", "google");
  });

  it("asks a free user to upgrade for any other provider", async () => {
    const { res, state } = createMockResponse();
    await handler(put({ aiProvider: "anthropic" }), res);
    expect(state.statusCode).toBe(402);
    expect(mockSetProvider).not.toHaveBeenCalled();
  });

  it("saves another provider for a Pro user", async () => {
    mockHasPro.mockReturnValue(true);
    const { res, state } = createMockResponse();
    await handler(put({ aiProvider: "anthropic" }), res);
    expect(state.statusCode).toBe(200);
    expect(state.jsonPayload).toEqual({ aiProvider: "anthropic" });
    expect(mockSetProvider).toHaveBeenCalledWith("u1", "anthropic");
  });

  it("answers 500 when the choice cannot be saved", async () => {
    mockSetProvider.mockRejectedValue(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, state } = createMockResponse();
    await handler(put({ aiProvider: "google" }), res);
    expect(state.statusCode).toBe(500);
  });
});
