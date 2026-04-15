import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getRequiredVercelKvEnv, getStripeProPriceId } from "./_lib/apiEnv.js";
import {
  getSubscription,
  setSubscription,
  setStripeCustomerMapping,
} from "./_lib/subscriptionGuard.js";
import {
  createStripeCustomer,
  createCheckoutSession,
} from "./_lib/stripeClient.js";

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

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/create-checkout-session");
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
    const { successUrl, cancelUrl } = body;

    if (!isValidUrl(successUrl) || !isValidUrl(cancelUrl)) {
      res.status(400).json({ error: "Invalid successUrl or cancelUrl." });
      return;
    }

    const kvEnv = getRequiredVercelKvEnv();
    const subscription = await getSubscription(auth.userId, kvEnv);

    // Create or reuse Stripe customer
    let stripeCustomerId = subscription.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await createStripeCustomer(auth.email, auth.userId);
      stripeCustomerId = customer.id;

      // Store both mappings
      await setSubscription(auth.userId, { ...subscription, stripeCustomerId }, kvEnv);
      await setStripeCustomerMapping(stripeCustomerId, auth.userId, kvEnv);
    }

    const session = await createCheckoutSession(
      stripeCustomerId,
      getStripeProPriceId(),
      auth.userId,
      successUrl,
      cancelUrl
    );

    res.status(200).json({ url: session.url });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
