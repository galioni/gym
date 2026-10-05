import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appleBearerToken,
  lookupAppleSubscription,
  lookupGoogleSubscription,
  resetGoogleTokenCache,
  storeStateGrantsPro,
  StoreLookupError,
  type StoreSubscriptionState,
} from "./storeVerification";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const PRODUCTS = new Set(["pro_monthly"]);

const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const apple = {
  keyId: "KEY123",
  issuerId: "issuer-uuid",
  bundleId: "com.example.dailygrind",
  privateKey: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const google = {
  packageName: "com.example.dailygrind",
  clientEmail: "svc@project.iam.gserviceaccount.com",
  privateKey: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

function jws(payload: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function appleBody(over: { status?: number; info?: Record<string, unknown>; bundleId?: string } = {}) {
  return {
    bundleId: over.bundleId ?? apple.bundleId,
    data: [
      {
        lastTransactions: [
          {
            status: over.status ?? 1,
            signedTransactionInfo: jws({
              originalTransactionId: "orig-1",
              productId: "pro_monthly",
              expiresDate: Date.parse("2026-11-03T12:00:00Z"),
              appAccountToken: "AAAAAAAA-0000-4000-8000-000000000001",
              ...over.info,
            }),
          },
        ],
      },
    ],
  };
}

describe("apple bearer token", () => {
  it("is an ES256 JWT with Apple's claims that verifies with the public key", () => {
    const token = appleBearerToken(apple, NOW);
    const [h, c, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: "issuer-uuid", aud: "appstoreconnect-v1", bid: apple.bundleId, iat: NOW / 1000 });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(20 * 60);
    const ok = crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("lookupAppleSubscription", () => {
  it("reads the subscription, lower-casing the account token", async () => {
    const f = vi.fn().mockResolvedValue(reply(200, appleBody()));
    const state = await lookupAppleSubscription("t-9", apple, PRODUCTS, { fetch: f, now: () => NOW });
    expect(state).toEqual({
      platform: "apple",
      transactionId: "orig-1",
      previousTransactionId: null,
      productId: "pro_monthly",
      access: "active",
      expiresAt: "2026-11-03T12:00:00.000Z",
      accountId: "aaaaaaaa-0000-4000-8000-000000000001",
    });
    expect(f.mock.calls[0][0]).toBe("https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/t-9");
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer .+\..+\..+$/) });
  });

  it("falls back to the sandbox for a purchase production does not know", async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(reply(200, appleBody()));
    const state = await lookupAppleSubscription("t", apple, PRODUCTS, { fetch: f, now: () => NOW });
    expect(state.transactionId).toBe("orig-1");
    expect(f.mock.calls[1][0]).toContain("api.storekit-sandbox.itunes.apple.com");
  });

  it("says not found when neither environment knows it", async () => {
    const f = vi.fn().mockResolvedValue(reply(404));
    await expect(lookupAppleSubscription("t", apple, PRODUCTS, { fetch: f })).rejects.toMatchObject({ reason: "not_found" });
  });

  it("maps Apple's statuses", async () => {
    const access = async (status: number, info = {}) =>
      (await lookupAppleSubscription("t", apple, PRODUCTS, { fetch: vi.fn().mockResolvedValue(reply(200, appleBody({ status, info }))) })).access;
    expect(await access(1)).toBe("active");
    expect(await access(4)).toBe("grace");
    expect(await access(3)).toBe("retry");
    expect(await access(2)).toBe("expired");
    expect(await access(5)).toBe("revoked");
    expect(await access(1, { revocationDate: 1 })).toBe("revoked");
  });

  it("refuses another app's purchase and products that do not grant Pro", async () => {
    await expect(
      lookupAppleSubscription("t", apple, PRODUCTS, { fetch: vi.fn().mockResolvedValue(reply(200, appleBody({ bundleId: "com.other" }))) })
    ).rejects.toMatchObject({ reason: "wrong_app" });
    await expect(
      lookupAppleSubscription("t", apple, PRODUCTS, { fetch: vi.fn().mockResolvedValue(reply(200, appleBody({ info: { productId: "coins" } }))) })
    ).rejects.toMatchObject({ reason: "unknown_product" });
  });

  it("reports an Apple outage as unavailable, not as 'no such purchase'", async () => {
    await expect(lookupAppleSubscription("t", apple, PRODUCTS, { fetch: vi.fn().mockResolvedValue(reply(500)) })).rejects.toMatchObject({
      reason: "unavailable",
    });
  });
});

describe("lookupGoogleSubscription", () => {
  beforeEach(() => resetGoogleTokenCache());

  function googleFetch(subscription: Record<string, unknown> | Response) {
    return vi.fn(async (url: string) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return reply(200, { access_token: "ya29.token", expires_in: 3600 });
      return subscription instanceof Response ? subscription : reply(200, subscription);
    });
  }
  const sub = (over: Record<string, unknown> = {}) => ({
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItems: [{ productId: "pro_monthly", expiryTime: "2026-11-03T12:00:00Z" }],
    externalAccountIdentifiers: { obfuscatedExternalAccountId: "AAAAAAAA-0000-4000-8000-000000000001" },
    ...over,
  });

  it("signs in with a service-account JWT and reads the subscription", async () => {
    const f = googleFetch(sub());
    const state = await lookupGoogleSubscription("tok/1", google, PRODUCTS, { fetch: f as unknown as typeof fetch, now: () => NOW });
    expect(state).toEqual({
      platform: "google",
      transactionId: "tok/1",
      previousTransactionId: null,
      productId: "pro_monthly",
      access: "active",
      expiresAt: "2026-11-03T12:00:00.000Z",
      accountId: "aaaaaaaa-0000-4000-8000-000000000001",
    });

    const tokenCall = f.mock.calls[0] as unknown as [string, RequestInit];
    const assertion = new URLSearchParams(tokenCall[1].body as string).get("assertion")!;
    const [h, c, s] = assertion.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({
      iss: google.clientEmail,
      scope: "https://www.googleapis.com/auth/androidpublisher",
    });
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), rsa.publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect((f.mock.calls[1] as unknown as [string])[0]).toContain("/purchases/subscriptionsv2/tokens/tok%2F1");
  });

  it("reuses the access token until it is about to expire", async () => {
    const f = googleFetch(sub());
    await lookupGoogleSubscription("a", google, PRODUCTS, { fetch: f as unknown as typeof fetch, now: () => NOW });
    await lookupGoogleSubscription("b", google, PRODUCTS, { fetch: f as unknown as typeof fetch, now: () => NOW + 60_000 });
    expect(f.mock.calls.filter((c) => (c as unknown as [string])[0].includes("oauth2")).length).toBe(1);
  });

  it("maps states: cancelled keeps access until the period ends", async () => {
    const access = async (state: string, expiry = "2026-11-03T12:00:00Z") => {
      resetGoogleTokenCache();
      const f = googleFetch(sub({ subscriptionState: state, lineItems: [{ productId: "pro_monthly", expiryTime: expiry }] }));
      return (await lookupGoogleSubscription("t", google, PRODUCTS, { fetch: f as unknown as typeof fetch, now: () => NOW })).access;
    };
    expect(await access("SUBSCRIPTION_STATE_ACTIVE")).toBe("active");
    expect(await access("SUBSCRIPTION_STATE_IN_GRACE_PERIOD")).toBe("grace");
    expect(await access("SUBSCRIPTION_STATE_CANCELED")).toBe("active");
    expect(await access("SUBSCRIPTION_STATE_CANCELED", "2026-10-01T00:00:00Z")).toBe("expired");
    expect(await access("SUBSCRIPTION_STATE_ON_HOLD")).toBe("retry");
    expect(await access("SUBSCRIPTION_STATE_PAUSED")).toBe("expired");
    expect(await access("SUBSCRIPTION_STATE_EXPIRED")).toBe("expired");
    expect(await access("SUBSCRIPTION_STATE_PENDING")).toBe("pending");
  });

  it("follows a replaced token, and refuses unknown products and unknown purchases", async () => {
    const linked = googleFetch(sub({ linkedPurchaseToken: "old-token" }));
    const state = await lookupGoogleSubscription("new", google, PRODUCTS, { fetch: linked as unknown as typeof fetch, now: () => NOW });
    expect(state.previousTransactionId).toBe("old-token");

    resetGoogleTokenCache();
    const other = googleFetch(sub({ lineItems: [{ productId: "coins", expiryTime: "2026-11-03T12:00:00Z" }] }));
    await expect(lookupGoogleSubscription("t", google, PRODUCTS, { fetch: other as unknown as typeof fetch })).rejects.toMatchObject({
      reason: "unknown_product",
    });

    resetGoogleTokenCache();
    const missing = googleFetch(reply(410));
    await expect(lookupGoogleSubscription("t", google, PRODUCTS, { fetch: missing as unknown as typeof fetch })).rejects.toBeInstanceOf(
      StoreLookupError
    );
  });
});

describe("storeStateGrantsPro", () => {
  const base: StoreSubscriptionState = {
    platform: "apple",
    transactionId: "x",
    previousTransactionId: null,
    productId: "p",
    access: "active",
    expiresAt: "2026-11-03T12:00:00.000Z",
    accountId: null,
  };
  it("needs paid-up access and a period that has not ended", () => {
    expect(storeStateGrantsPro(base, NOW)).toBe(true);
    expect(storeStateGrantsPro({ ...base, access: "grace" }, NOW)).toBe(true);
    expect(storeStateGrantsPro({ ...base, access: "retry" }, NOW)).toBe(false);
    expect(storeStateGrantsPro({ ...base, access: "revoked" }, NOW)).toBe(false);
    expect(storeStateGrantsPro({ ...base, expiresAt: "2026-10-01T00:00:00.000Z" }, NOW)).toBe(false);
  });
});
