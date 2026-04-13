import { requireAuth } from "./_lib/authContext.js";
import { setCorsHeaders, handlePreflight, parseJsonBody } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";
import { createBillingPortalSession } from "./_lib/stripeClient.js";

function isValidUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return true;
    // Allow http://localhost in local development only
    return process.env.VERCEL_ENV !== "production" && parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/billing-portal");
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
    const { returnUrl } = body;

    if (!isValidUrl(returnUrl)) {
      res.status(400).json({ error: "Invalid returnUrl." });
      return;
    }

    const kvEnv = getRequiredVercelKvEnv();
    const subscription = await getSubscription(auth.userId, kvEnv);

    if (!subscription.stripeCustomerId) {
      res.status(400).json({ error: "No active subscription found." });
      return;
    }

    const session = await createBillingPortalSession(
      subscription.stripeCustomerId,
      returnUrl
    );

    res.status(200).json({ url: session.url });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
