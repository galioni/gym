import { CloudSyncApiService } from "../application/sync/CloudSyncApiService";
import { isTemplateSnapshotPayload } from "../application/sync/cloudApiRules";
import { VercelKvCloudDocumentStore } from "../infrastructure/sync/vercel/VercelKvCloudDocumentStore";
import {
  enforceApiKey,
  enforceMethod,
  handlePreflight,
  parseJsonBody,
  setCorsHeaders,
} from "./_lib/http";

const TEMPLATES_KEY = "sync:templates";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export default async function handler(req: any, res: any): Promise<void> {
  setCorsHeaders(res);
  if (handlePreflight(req, res)) {
    return;
  }
  if (!enforceMethod(req, res)) {
    return;
  }

  try {
    const syncApiKey = getRequiredEnv("SYNC_API_KEY");
    if (!enforceApiKey(req, res, syncApiKey)) {
      return;
    }

    const service = new CloudSyncApiService(
      new VercelKvCloudDocumentStore({
        kvRestApiUrl: getRequiredEnv("KV_REST_API_URL"),
        kvRestApiToken: getRequiredEnv("KV_REST_API_TOKEN"),
      })
    );

    if (req.method === "GET") {
      const payload = await service.getResource<Record<string, unknown>>(TEMPLATES_KEY);
      if (!payload) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(200).json(payload);
      return;
    }

    const payload = parseJsonBody<Record<string, unknown> | null>(req, null);
    if (!isTemplateSnapshotPayload(payload)) {
      res.status(400).json({ error: "Invalid template payload." });
      return;
    }
    await service.putResource(TEMPLATES_KEY, payload);
    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown API error";
    res.status(500).json({ error: message });
  }
}
