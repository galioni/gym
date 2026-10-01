import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getRequiredApiEnv } from "./_lib/apiEnv.js";
import { getSubscription } from "./_lib/subscriptionGuard.js";
import { deleteStripeCustomer } from "./_lib/stripeClient.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/delete-account");
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    observation.setUserId(auth.userId);

    // Read the subscription first: it holds the Stripe customer id, which is gone once the auth user is deleted.
    let stripeCustomerId: string | null = null;
    try {
      const subscription = await getSubscription(auth.userId);
      stripeCustomerId = subscription.stripeCustomerId;
    } catch {
      // Non-fatal — proceed even if subscription lookup fails.
    }

    // Everything else (workouts, settings, subscription) lives in Postgres and goes with the auth user through the cascade
    // below.

    // Best-effort: delete the Stripe customer record. Non-fatal if it fails.
    if (stripeCustomerId) {
      try {
        await deleteStripeCustomer(stripeCustomerId);
      } catch (err) {
        console.error("[delete-account] Failed to delete Stripe customer (non-fatal)", { stripeCustomerId, err });
      }
    }

    // Delete the Supabase auth account last — this invalidates all active tokens.
    const supabaseAdmin = createClient(
      getRequiredApiEnv("SUPABASE_URL"),
      getRequiredApiEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(auth.userId);
    if (deleteError) {
      throw new Error(`Supabase user deletion failed: ${deleteError.message}`);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({
      error: "Account deletion failed. Please try again or contact support.",
      requestId: observation.requestId,
    });
  }
}
