import { CloudSyncApiService } from "./_lib/cloudSyncApiService.js";
import { isWorkoutSnapshotPayload } from "./_lib/cloudApiRules.js";
import { VercelKvCloudDocumentStore } from "./_lib/vercelKvCloudDocumentStore.js";
import { requireAuth } from "./_lib/authContext.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { syncRequestGuards } from "./_lib/requestGuards.js";
import {
  enforceMethod,
  handlePreflight,
  parseJsonBody,
  setCorsHeaders,
} from "./_lib/http.js";

const WORKOUT_DATA_KEY_SUFFIX = "workout-data";

export default async function handler(req: any, res: any): Promise<void> {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) {
    return;
  }
  if (!enforceMethod(req, res)) {
    return;
  }
  if (!syncRequestGuards.enforceRateLimit(req, res, WORKOUT_DATA_KEY_SUFFIX)) {
    return;
  }
  if (!syncRequestGuards.enforcePutJsonContentType(req, res)) {
    return;
  }
  if (!syncRequestGuards.enforcePutBodySize(req, res)) {
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const service = new CloudSyncApiService(
      new VercelKvCloudDocumentStore(getRequiredVercelKvEnv())
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
    console.error("workout-data handler error", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
