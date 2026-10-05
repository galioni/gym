import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockResponse } from "./_lib/testHelpers";

vi.mock("./_lib/storePurchases.js", () => ({ refreshStorePurchase: vi.fn() }));

import handler from "./store-notifications";
import { refreshStorePurchase } from "./_lib/storePurchases.js";

const refresh = vi.mocked(refreshStorePurchase);

function jws(payload: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

async function call(query: string, body: unknown, method = "POST") {
  const { res, state } = createMockResponse();
  await handler({ method, headers: {}, body, url: `/api/store-notifications${query}` }, res);
  return state;
}

const appleBody = (bundleId = "com.example.app") => ({
  signedPayload: jws({ notificationType: "DID_RENEW", data: { bundleId, signedTransactionInfo: jws({ originalTransactionId: "orig-1" }) } }),
});
const googleBody = (notification: Record<string, unknown>) => ({
  message: { data: Buffer.from(JSON.stringify(notification)).toString("base64") },
});

const ENV = ["STORE_WEBHOOK_SECRET", "APPLE_IAP_KEY_ID", "APPLE_IAP_ISSUER_ID", "APPLE_IAP_PRIVATE_KEY", "APPLE_BUNDLE_ID"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.STORE_WEBHOOK_SECRET = "s3cret";
  process.env.APPLE_IAP_KEY_ID = "k";
  process.env.APPLE_IAP_ISSUER_ID = "i";
  process.env.APPLE_IAP_PRIVATE_KEY = "p";
  process.env.APPLE_BUNDLE_ID = "com.example.app";
  refresh.mockResolvedValue(true);
});
afterEach(() => {
  for (const name of ENV) delete process.env[name];
  vi.restoreAllMocks();
});

describe("POST /api/store-notifications", () => {
  it("is off until a webhook secret is set", async () => {
    delete process.env.STORE_WEBHOOK_SECRET;
    expect((await call("?platform=apple&token=x", appleBody())).statusCode).toBe(503);
  });

  it("refuses a missing or wrong secret, and other methods", async () => {
    expect((await call("?platform=apple", appleBody())).statusCode).toBe(401);
    expect((await call("?platform=apple&token=wrong", appleBody())).statusCode).toBe(401);
    expect((await call("?platform=apple&token=s3cret", appleBody(), "GET")).statusCode).toBe(405);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the Apple purchase named in a notification", async () => {
    const state = await call("?platform=apple&token=s3cret", appleBody());
    expect(state.statusCode).toBe(200);
    expect(refresh).toHaveBeenCalledWith("apple", "orig-1");
  });

  it("ignores Apple notifications for another app, and ones without a transaction (TEST)", async () => {
    expect((await call("?platform=apple&token=s3cret", appleBody("com.other"))).statusCode).toBe(200);
    expect((await call("?platform=apple&token=s3cret", { signedPayload: jws({ notificationType: "TEST", data: {} }) })).statusCode).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the Google purchase named in a Pub/Sub message", async () => {
    const state = await call("?platform=google&token=s3cret", googleBody({ subscriptionNotification: { purchaseToken: "tok-1", notificationType: 2 } }));
    expect(state.statusCode).toBe(200);
    expect(refresh).toHaveBeenCalledWith("google", "tok-1");
  });

  it("acknowledges Google test messages and one-time purchase events without doing anything", async () => {
    expect((await call("?platform=google&token=s3cret", googleBody({ testNotification: { version: "1.0" } }))).statusCode).toBe(200);
    expect((await call("?platform=google&token=s3cret", googleBody({ oneTimeProductNotification: {} }))).statusCode).toBe(200);
    expect((await call("?platform=google&token=s3cret", {})).statusCode).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects an unknown platform", async () => {
    expect((await call("?platform=windows&token=s3cret", {})).statusCode).toBe(400);
  });

  it("answers 5xx when the refresh fails, so the store retries", async () => {
    refresh.mockRejectedValue(new Error("db down"));
    expect((await call("?platform=apple&token=s3cret", appleBody())).statusCode).toBe(500);
  });
});
