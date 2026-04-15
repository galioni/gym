import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody, isAllowedReturnUrl } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";
import { createBillingPortalSession } from "./_lib/stripeClient.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
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

    if (!isAllowedReturnUrl(returnUrl)) {
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
