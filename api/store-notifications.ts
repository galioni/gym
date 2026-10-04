import crypto from "crypto";
import { ApiRequest, ApiResponse, getHeader, parseJsonBody } from "./_lib/http.js";
import { getAppleIapConfig, getStoreWebhookSecret } from "./_lib/storeEnv.js";
import { refreshStorePurchase } from "./_lib/storePurchases.js";

type NotificationRequest = ApiRequest & { url?: string; query?: Record<string, string | string[] | undefined> };

function queryValue(req: NotificationRequest, name: string): string | null {
  const fromQuery = req.query?.[name];
  if (typeof fromQuery === "string") return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === "string") return fromQuery[0];
  if (req.url) {
    try {
      return new URL(req.url, "https://localhost").searchParams.get(name);
    } catch {
      return null;
    }
  }
  return null;
}

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function decodePart(jws: unknown): Record<string, unknown> | null {
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

/**
 * POST /api/store-notifications?platform=apple|google&token=<STORE_WEBHOOK_SECRET>
 *
 *   apple:  App Store Server Notifications V2, body { signedPayload }.
 *   google: Real-time developer notifications through a Pub/Sub push subscription, body { message: { data } }.
 *
 * A notification is only a nudge. It is read for the purchase id, and then the store is asked for the current state with
 * our own credentials, so a forged or replayed notification cannot change anything. The shared secret in the URL keeps
 * strangers from using the endpoint to make the server call the stores.
 *
 * Answers 2xx for anything that cannot matter (unknown purchase, test message), because the stores retry non-2xx for days.
 */
export default async function handler(req: NotificationRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = getStoreWebhookSecret();
  if (!secret) {
    res.status(503).json({ error: "Store notifications are not configured." });
    return;
  }
  if (!secretMatches(queryValue(req, "token") ?? getHeader(req, "x-store-webhook-token"), secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const platform = queryValue(req, "platform");
  const body = parseJsonBody<Record<string, unknown>>(req, {});

  try {
    if (platform === "apple") {
      const payload = decodePart(body.signedPayload);
      const data = payload?.data as { bundleId?: unknown; signedTransactionInfo?: unknown } | undefined;
      const info = decodePart(data?.signedTransactionInfo);
      const transactionId = info?.originalTransactionId;
      const ourBundle = getAppleIapConfig()?.bundleId;
      // TEST notifications and anything for another app carry nothing to refresh.
      if (typeof transactionId !== "string" || !ourBundle || data?.bundleId !== ourBundle) {
        res.status(200).json({ received: true });
        return;
      }
      await refreshStorePurchase("apple", transactionId);
    } else if (platform === "google") {
      const message = body.message as { data?: unknown } | undefined;
      const decoded = typeof message?.data === "string" ? decodePart(`x.${message.data}.x`) : null;
      const notification = decoded?.subscriptionNotification as { purchaseToken?: unknown } | undefined;
      if (typeof notification?.purchaseToken !== "string") {
        res.status(200).json({ received: true }); // a test notification, or a one-time purchase event
        return;
      }
      await refreshStorePurchase("google", notification.purchaseToken);
    } else {
      res.status(400).json({ error: "Unknown platform." });
      return;
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[store-notifications] handler error", error instanceof Error ? error.message : String(error));
    // 5xx makes the store retry later, which is right for a database or store outage.
    res.status(500).json({ error: "Internal server error" });
  }
}
