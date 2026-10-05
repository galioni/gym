import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody, isAllowedReturnUrl } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getStripeProPriceId } from "./_lib/apiEnv.js";
import { getSubscription, hasProAccess, setSubscription } from "./_lib/subscriptionGuard.js";
import {
  createStripeCustomer,
  createCheckoutSession,
} from "./_lib/stripeClient.js";

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

    if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
      res.status(400).json({ error: "Invalid successUrl or cancelUrl." });
      return;
    }

    const subscription = await getSubscription(auth.userId);

    // Someone already paying through the App Store or Google Play must not also be billed by Stripe.
    if (hasProAccess(subscription) && (subscription.source === "apple" || subscription.source === "google")) {
      const store = subscription.source === "apple" ? "the App Store" : "Google Play";
      res.status(409).json({ error: `You already have an active subscription through ${store}. Manage it there.` });
      return;
    }

    // Create or reuse Stripe customer
    let stripeCustomerId = subscription.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await createStripeCustomer(auth.email, auth.userId);
      stripeCustomerId = customer.id;

      // The customer id on the user's subscription row is also how the webhook finds the user later.
      await setSubscription(auth.userId, { ...subscription, stripeCustomerId });
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
