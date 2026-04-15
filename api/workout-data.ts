import { CloudSyncApiService } from "./_lib/cloudSyncApiService.js";
import { isWorkoutSnapshotPayload } from "./_lib/cloudApiRules.js";
import { VercelKvCloudDocumentStore } from "./_lib/vercelKvCloudDocumentStore.js";
import { requireAuth } from "./_lib/authContext.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { SyncRequestGuards } from "./_lib/requestGuards.js";
import { FixedWindowRateLimiter, checkRateLimit } from "./_lib/rateLimiter.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getSubscription, hasProAccess, hasProReadAccess } from "./_lib/subscriptionGuard.js";
import {
  ApiRequest,
  ApiResponse,
  enforceMethod,
  handlePreflight,
  parseJsonBody,
  setCorsHeaders,
} from "./_lib/http.js";

const WORKOUT_DATA_KEY_SUFFIX = "workout-data";

// IP-based burst protection — shared across invocations within the same process instance.
const guards = new SyncRequestGuards(
  new FixedWindowRateLimiter({ maxRequests: 30, windowMs: 60_000 })
);

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/workout-data");
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) {
    return;
  }
  if (!enforceMethod(req, res)) {
    return;
  }

  if (!guards.enforceRateLimit(req, res, WORKOUT_DATA_KEY_SUFFIX)) {
    return;
  }
  if (!guards.enforcePutJsonContentType(req, res)) {
    return;
  }
  if (!guards.enforcePutBodySize(req, res)) {
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }
    observation.setUserId(auth.userId);

    const kvEnv = getRequiredVercelKvEnv();

    // Per-user Redis rate limit — cross-instance, tied to authenticated user.
    const rateLimit = await checkRateLimit(
      auth.userId,
      WORKOUT_DATA_KEY_SUFFIX,
      kvEnv.kvRestApiUrl,
      kvEnv.kvRestApiToken
    );
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const subscription = await getSubscription(auth.userId, kvEnv);
    if (req.method === "GET" ? !hasProReadAccess(subscription) : !hasProAccess(subscription)) {
      res.status(402).json({ error: "Cloud sync requires a Pro subscription." });
      return;
    }

    const service = new CloudSyncApiService(
      new VercelKvCloudDocumentStore(kvEnv)
    );
    const key = `sync:${auth.userId}:${WORKOUT_DATA_KEY_SUFFIX}`;

    if (req.method === "GET") {
      const payload = await service.getResource<Record<string, unknown>>(key);
      if (!payload) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(200).json(payload);
      return;
    }

    const payload = parseJsonBody<Record<string, unknown> | null>(req, null);
    if (!isWorkoutSnapshotPayload(payload)) {
      res.status(400).json({ error: "Invalid workout payload." });
      return;
    }
    await service.putResource(key, payload);
    res.status(200).json({ ok: true });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({
      error: "Internal server error",
      requestId: observation.requestId,
    });
  }
}
