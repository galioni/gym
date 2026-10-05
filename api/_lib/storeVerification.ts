import crypto from "crypto";
import type { AppleIapConfig, GooglePlayConfig } from "./storeEnv.js";

/**
 * Asking the stores what a purchase is worth. The app only ever hands over an id (Apple transaction id / Google purchase
 * token); what it is worth, who it belongs to and when it ends all come from the store's own API, authenticated with our
 * credentials. Nothing the phone says about the purchase is believed.
 */

export type StorePlatform = "apple" | "google";

/** How the store sees the subscription, reduced to what decides access. */
export type StoreAccess = "active" | "grace" | "retry" | "expired" | "revoked" | "pending";

export interface StoreSubscriptionState {
  platform: StorePlatform;
  /** The stable id kept on the subscription row: Apple's originalTransactionId, Google's (latest) purchase token. */
  transactionId: string;
  /** Google only: the token this one replaced (an upgrade or resubscribe), so the row can follow the chain. */
  previousTransactionId: string | null;
  productId: string;
  access: StoreAccess;
  /** End of the paid period, ISO. */
  expiresAt: string | null;
  /** The account id the app attached at purchase time (Apple appAccountToken / Google obfuscatedAccountId). */
  accountId: string | null;
}

export type StoreLookupFailure = "not_found" | "unknown_product" | "wrong_app" | "unavailable";

export class StoreLookupError extends Error {
  constructor(
    readonly reason: StoreLookupFailure,
    message: string
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeJwsPayload(jws: unknown): Record<string, unknown> | null {
  if (typeof jws !== "string") return null;
  const part = jws.split(".")[1];
  if (!part) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Apple: App Store Server API, "Get All Subscription Statuses"
// ---------------------------------------------------------------------------------------------------------------------

const APPLE_PRODUCTION = "https://api.storekit.itunes.apple.com";
const APPLE_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";

/** The bearer token Apple asks for: ES256, valid for 20 minutes at most. */
export function appleBearerToken(config: AppleIapConfig, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: config.issuerId, iat: issuedAt, exp: issuedAt + 20 * 60, aud: "appstoreconnect-v1", bid: config.bundleId })
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(signature)}`;
}

/** App Store Server API subscription status codes. */
function appleAccess(status: unknown): StoreAccess {
  switch (status) {
    case 1:
      return "active";
    case 4:
      return "grace"; // billing problem, but Apple keeps the person entitled during the grace period
    case 3:
      return "retry"; // Apple is still retrying the charge; no entitlement meanwhile
    case 5:
      return "revoked";
    default:
      return "expired";
  }
}

export async function lookupAppleSubscription(
  transactionId: string,
  config: AppleIapConfig,
  proProductIds: ReadonlySet<string>,
  deps: { fetch?: FetchLike; now?: () => number } = {}
): Promise<StoreSubscriptionState> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const path = `/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`;

  // Production first; a purchase made in the sandbox (TestFlight, App Review) is unknown there, which Apple answers with 404.
  let body: Record<string, unknown> | null = null;
  for (const host of [APPLE_PRODUCTION, APPLE_SANDBOX]) {
    const response = await doFetch(`${host}${path}`, { headers: { Authorization: `Bearer ${appleBearerToken(config, now())}` } });
    if (response.status === 404) continue;
    if (!response.ok) throw new StoreLookupError("unavailable", `App Store lookup failed (${response.status})`);
    body = (await response.json()) as Record<string, unknown>;
    break;
  }
  if (!body) throw new StoreLookupError("not_found", "The App Store does not know this purchase.");
  if (body.bundleId !== config.bundleId) throw new StoreLookupError("wrong_app", "This purchase is for a different app.");

  const groups = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
  for (const group of groups) {
    const transactions = Array.isArray(group.lastTransactions) ? (group.lastTransactions as Array<Record<string, unknown>>) : [];
    for (const entry of transactions) {
      // The response comes straight from Apple over TLS, authenticated with our key, so its signed payloads are read as-is.
      const info = decodeJwsPayload(entry.signedTransactionInfo);
      if (!info || typeof info.productId !== "string" || !proProductIds.has(info.productId)) continue;
      const original = typeof info.originalTransactionId === "string" ? info.originalTransactionId : null;
      if (!original) continue;
      const expires = typeof info.expiresDate === "number" ? new Date(info.expiresDate).toISOString() : null;
      return {
        platform: "apple",
        transactionId: original,
        previousTransactionId: null,
        productId: info.productId,
        access: info.revocationDate ? "revoked" : appleAccess(entry.status),
        expiresAt: expires,
        accountId: typeof info.appAccountToken === "string" ? info.appAccountToken.toLowerCase() : null,
      };
    }
  }
  throw new StoreLookupError("unknown_product", "This purchase is not a Daily Grind Pro subscription.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Google: Play Developer API, purchases.subscriptionsv2.get
// ---------------------------------------------------------------------------------------------------------------------

let cachedGoogleToken: { key: string; token: string; expiresAtMs: number } | null = null;

async function googleAccessToken(config: GooglePlayConfig, doFetch: FetchLike, nowMs: number): Promise<string> {
  const key = config.clientEmail;
  if (cachedGoogleToken && cachedGoogleToken.key === key && cachedGoogleToken.expiresAtMs - 60_000 > nowMs) return cachedGoogleToken.token;

  const issuedAt = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), config.privateKey);
  const response = await doFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }).toString(),
  });
  if (!response.ok) throw new StoreLookupError("unavailable", `Google sign-in failed (${response.status})`);
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string") throw new StoreLookupError("unavailable", "Google sign-in returned no token");
  const lifetime = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cachedGoogleToken = { key, token: json.access_token, expiresAtMs: nowMs + lifetime * 1000 };
  return json.access_token;
}

/** Test hook: forget the cached Google access token. */
export function resetGoogleTokenCache(): void {
  cachedGoogleToken = null;
}

function googleAccess(state: unknown, expiresAtMs: number | null, nowMs: number): StoreAccess {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return "active";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "grace";
    // Cancelled means "will not renew": the person has paid up to the end of the period.
    case "SUBSCRIPTION_STATE_CANCELED":
      return expiresAtMs !== null && expiresAtMs > nowMs ? "active" : "expired";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "retry";
    case "SUBSCRIPTION_STATE_PENDING":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      return "pending";
    default:
      return "expired"; // expired, paused, anything new Google adds
  }
}

export async function lookupGoogleSubscription(
  purchaseToken: string,
  config: GooglePlayConfig,
  proProductIds: ReadonlySet<string>,
  deps: { fetch?: FetchLike; now?: () => number } = {}
): Promise<StoreSubscriptionState> {
  const doFetch = deps.fetch ?? fetch;
  const nowMs = (deps.now ?? Date.now)();
  const accessToken = await googleAccessToken(config, doFetch, nowMs);

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await doFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404 || response.status === 410 || response.status === 400) {
    throw new StoreLookupError("not_found", "Google Play does not know this purchase.");
  }
  if (!response.ok) throw new StoreLookupError("unavailable", `Google Play lookup failed (${response.status})`);
  const body = (await response.json()) as Record<string, unknown>;

  const items = Array.isArray(body.lineItems) ? (body.lineItems as Array<Record<string, unknown>>) : [];
  const item = items.find((i) => typeof i.productId === "string" && proProductIds.has(i.productId));
  if (!item || typeof item.productId !== "string") {
    throw new StoreLookupError("unknown_product", "This purchase is not a Daily Grind Pro subscription.");
  }
  const expiresAtMs = typeof item.expiryTime === "string" ? Date.parse(item.expiryTime) : NaN;
  const expiry = Number.isFinite(expiresAtMs) ? expiresAtMs : null;
  const identifiers = body.externalAccountIdentifiers as { obfuscatedExternalAccountId?: unknown } | undefined;

  return {
    platform: "google",
    transactionId: purchaseToken,
    previousTransactionId: typeof body.linkedPurchaseToken === "string" ? body.linkedPurchaseToken : null,
    productId: item.productId,
    access: googleAccess(body.subscriptionState, expiry, nowMs),
    expiresAt: expiry === null ? null : new Date(expiry).toISOString(),
    accountId: typeof identifiers?.obfuscatedExternalAccountId === "string" ? identifiers.obfuscatedExternalAccountId.toLowerCase() : null,
  };
}

/** Pro access for a store state: paid up (including a grace period), and not past its end date. */
export function storeStateGrantsPro(state: StoreSubscriptionState, nowMs: number = Date.now()): boolean {
  if (state.access !== "active" && state.access !== "grace") return false;
  return state.expiresAt === null || Date.parse(state.expiresAt) > nowMs;
}
