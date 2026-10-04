import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { verifyStorePurchase, isStoreBillingConfigured, STORE_NOT_CONFIGURED } from "./_lib/storePurchases.js";
import type { StorePlatform } from "./_lib/storeVerification.js";

const MAX_TOKEN_LENGTH = 2048;

/**
 * POST /api/store-purchase { platform: "apple" | "google", token }
 *
 * The app calls this after a purchase or a restore, with the Apple transaction id or the Google purchase token. The
 * server asks the store what it is, links it to the signed-in account and answers with the account's subscription (the
 * same shape as GET /api/subscription).
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/store-purchase");
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    observation.setUserId(auth.userId);

    const body = parseJsonBody<Record<string, unknown>>(req, {});
    const platform = body.platform;
    const token = body.token;
    if ((platform !== "apple" && platform !== "google") || typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      res.status(400).json({ error: "Invalid platform or token." });
      return;
    }

    if (!isStoreBillingConfigured(platform as StorePlatform)) {
      res.status(503).json({ error: STORE_NOT_CONFIGURED });
      return;
    }

    const result = await verifyStorePurchase(auth.userId, platform as StorePlatform, token);
    res.setHeader("Cache-Control", "private, no-store");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json(result.subscription);
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
