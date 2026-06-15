import { getStripeSecretKey } from "./apiEnv.js";

/**
 * Minimal Stripe API client using fetch — no SDK dependency.
 */
async function stripeRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
  params?: Record<string, string>
): Promise<unknown> {
  const secretKey = getStripeSecretKey();
  const url = `https://api.stripe.com/v1${path}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  if (params && method === "POST") {
    init.body = new URLSearchParams(params).toString();
  }

  const response = await fetch(url, init);
  const data = await response.json();

  if (!response.ok) {
    const error = (data as { error?: { message?: string } }).error;
    throw new Error(`Stripe error: ${error?.message ?? response.status}`);
  }

  return data;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export interface StripeBillingPortalSession {
  url: string;
}

export interface StripeCustomer {
  id: string;
}

export interface StripeSubscription {
  id: string;
  status: string;
  current_period_end: number;
  customer: string;
}

export async function createStripeCustomer(
  email: string | null,
  userId: string
): Promise<StripeCustomer> {
  const params: Record<string, string> = {
    "metadata[userId]": userId,
  };
  if (email) params["email"] = email;
  return stripeRequest("/customers", "POST", params) as Promise<StripeCustomer>;
}

export async function createCheckoutSession(
  stripeCustomerId: string,
  priceId: string,
  clientReferenceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<StripeCheckoutSession> {
  return stripeRequest("/checkout/sessions", "POST", {
    customer: stripeCustomerId,
    mode: "subscription",
    "payment_method_types[0]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: clientReferenceId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  }) as Promise<StripeCheckoutSession>;
}

export async function deleteStripeCustomer(stripeCustomerId: string): Promise<void> {
  await stripeRequest(`/customers/${stripeCustomerId}`, "DELETE");
}

export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<StripeBillingPortalSession> {
  return stripeRequest("/billing_portal/sessions", "POST", {
    customer: stripeCustomerId,
    return_url: returnUrl,
  }) as Promise<StripeBillingPortalSession>;
}
