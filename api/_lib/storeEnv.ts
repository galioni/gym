/**
 * Configuration for store billing (App Store / Google Play). Every value is optional: until the developer accounts exist
 * nothing is configured, the store endpoints answer 503, and the apps keep showing the web upgrade note.
 */

function read(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Private keys pasted into a dashboard often arrive with literal "\n" instead of line breaks. */
function normalisePem(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export interface AppleIapConfig {
  /** App Store Connect > Users and Access > Integrations > In-App Purchase: the key id and the issuer id. */
  keyId: string;
  issuerId: string;
  /** The .p8 private key contents. */
  privateKey: string;
  bundleId: string;
}

export function getAppleIapConfig(): AppleIapConfig | null {
  const keyId = read("APPLE_IAP_KEY_ID");
  const issuerId = read("APPLE_IAP_ISSUER_ID");
  const privateKey = read("APPLE_IAP_PRIVATE_KEY");
  const bundleId = read("APPLE_BUNDLE_ID");
  if (!keyId || !issuerId || !privateKey || !bundleId) return null;
  return { keyId, issuerId, privateKey: normalisePem(privateKey), bundleId };
}

export interface GooglePlayConfig {
  packageName: string;
  clientEmail: string;
  privateKey: string;
}

/** `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is the service account key file, as JSON text. */
export function getGooglePlayConfig(): GooglePlayConfig | null {
  const packageName = read("GOOGLE_PLAY_PACKAGE_NAME");
  const json = read("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  if (!packageName || !json) return null;
  try {
    const parsed = JSON.parse(json) as { client_email?: unknown; private_key?: unknown };
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { packageName, clientEmail: parsed.client_email, privateKey: normalisePem(parsed.private_key) };
  } catch {
    return null;
  }
}

/** The store product ids that grant Pro (`STORE_PRO_PRODUCT_IDS`, comma separated). Empty means store billing is off. */
export function getStoreProProductIds(): Set<string> {
  return new Set(
    (read("STORE_PRO_PRODUCT_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

/** Shared secret in the notification URL (`?token=`). Apple cannot send custom headers, so a query value is what both stores allow. */
export function getStoreWebhookSecret(): string | null {
  return read("STORE_WEBHOOK_SECRET");
}
