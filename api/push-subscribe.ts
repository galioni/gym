import { requireAuth } from "./_lib/authContext.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { savePushSubscription, getPushSubscription, deletePushSubscription } from "./_lib/pushKv.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import {
  ApiRequest,
  ApiResponse,
  handlePreflight,
  parseJsonBody,
  setCorsHeaders,
} from "./_lib/http.js";

interface SubscribeBody {
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
  reminderMinuteUtc: number;
}

function isSubscribeBody(v: unknown): v is SubscribeBody {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (!b.subscription || typeof b.subscription !== "object") return false;
  const sub = b.subscription as Record<string, unknown>;
  if (typeof sub.endpoint !== "string") return false;
  if (!sub.keys || typeof sub.keys !== "object") return false;
  const keys = sub.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return false;
  if (typeof b.reminderMinuteUtc !== "number") return false;
  const minute = b.reminderMinuteUtc as number;
  if (!Number.isInteger(minute) || minute < 0 || minute > 1410 || minute % 30 !== 0) return false;
  return true;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/push-subscribe");
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (!req.method || !["GET", "POST", "DELETE"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    observation.setUserId(auth.userId);

    const env = getRequiredVercelKvEnv();

    if (req.method === "GET") {
      const record = await getPushSubscription(env, auth.userId);
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json({
        subscribed: record !== null,
        reminderMinuteUtc: record?.reminderMinuteUtc ?? null,
      });
      return;
    }

    if (req.method === "DELETE") {
      await deletePushSubscription(env, auth.userId);
      res.status(200).json({ ok: true });
      return;
    }

    // POST
    const body = parseJsonBody<unknown>(req, null);
    if (!isSubscribeBody(body)) {
      res.status(400).json({ error: "Invalid subscription payload." });
      return;
    }

    await savePushSubscription(env, auth.userId, {
      endpoint: body.subscription.endpoint,
      expirationTime: body.subscription.expirationTime,
      keys: body.subscription.keys,
      reminderMinuteUtc: body.reminderMinuteUtc,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
