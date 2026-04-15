import crypto from "crypto";
import type { IncomingMessage } from "node:http";
import { ApiResponse } from "./_lib/http.js";
import { getRequiredVercelKvEnv, getStripeWebhookSecret } from "./_lib/apiEnv.js";
import {
  getStripeCustomerUserId,
  setSubscription,
  setStripeCustomerMappingAndSubscription,
} from "./_lib/subscriptionGuard.js";

// Disable Vercel's body parser so we get the raw body for signature verification
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(",")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const k = segment.slice(0, eq);
    const v = segment.slice(eq + 1);
    if (k) parts[k] = v;
  }
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;

  // Reject events older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(v1, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

export default async function handler(req: IncomingMessage, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers["stripe-signature"] as string | undefined;

  if (!signature) {
    res.status(400).json({ error: "Missing Stripe-Signature header" });
    return;
  }

  let webhookSecret: string;
  try {
    webhookSecret = getStripeWebhookSecret();
  } catch {
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  try {
    const kvEnv = getRequiredVercelKvEnv();
    const obj = event.data.object;

    if (event.type === "checkout.session.completed") {
      const userId = obj["client_reference_id"] as string | null;
      const customerId = obj["customer"] as string | null;
      const _subscriptionId = obj["subscription"] as string | null;

      if (!userId || !customerId) {
        console.warn("[stripe-webhook] checkout.session.completed missing userId or customerId", {
          hasUserId: Boolean(userId),
          hasCustomerId: Boolean(customerId),
        });
        res.status(200).json({ received: true });
        return;
      }

      await setStripeCustomerMappingAndSubscription(
        customerId,
        userId,
        {
          plan: "pro",
          status: "active",
          stripeCustomerId: customerId,
          currentPeriodEnd: null, // will be updated by subscription.updated event
        },
        kvEnv
      );
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const customerId = obj["customer"] as string | null;
      if (!customerId) {
        res.status(200).json({ received: true });
        return;
      }

      const userId = await getStripeCustomerUserId(customerId, kvEnv);
      if (!userId) {
        res.status(200).json({ received: true });
        return;
      }

      const subStatus = obj["status"] as string;
      const periodEnd = obj["current_period_end"] as number | null;
      const isActive =
        subStatus === "active" || subStatus === "trialing";

      await setSubscription(
        userId,
        {
          plan: isActive ? "pro" : "free",
          status: subStatus,
          stripeCustomerId: customerId,
          currentPeriodEnd: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
        },
        kvEnv
      );
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook handler error", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
