// One-time admin endpoint — removes a specific broken video URL. Deleted after use.
// Auth: Authorization: Bearer <SYNC_API_KEY>
import { VercelKvCloudDocumentStore } from "./_lib/vercelKvCloudDocumentStore.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { ApiRequest, ApiResponse, setCorsHeaders } from "./_lib/http.js";

const USER_ID    = "26cdb4b3-c5aa-4c49-a8b5-58c800ca11a0";
const BROKEN_URL = "https://www.youtube.com/watch?v=xT7TkTHHWJI";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCorsHeaders(req, res);

  const secret = process.env.SYNC_API_KEY ?? process.env.VITE_SYNC_API_KEY ?? "";
  const auth   = (req.headers?.["authorization"] as string | undefined) ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const store = new VercelKvCloudDocumentStore(getRequiredVercelKvEnv());

  const templatesKey = `sync:${USER_ID}:templates`;
  const workoutKey   = `sync:${USER_ID}:workout-data`;

  const [templateDoc, workoutDoc] = await Promise.all([
    store.readDocument(templatesKey),
    store.readDocument(workoutKey),
  ]);

  const removed: string[] = [];

  // --- Templates ---
  const tDoc = templateDoc as Record<string, unknown> | null;
  const templates = (tDoc?.templates ?? tDoc ?? {}) as Record<string, Record<string, unknown>>;
  let tDirty = false;

  for (const [session, tpl] of Object.entries(templates)) {
    if ((tpl as Record<string, unknown>).videoUrl === BROKEN_URL) {
      (tpl as Record<string, unknown>).videoUrl = undefined;
      removed.push(`template:${session}:session-level`);
      tDirty = true;
    }
    for (const section of ["warmup", "main"] as const) {
      for (const item of (tpl[section] as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.videoUrl === BROKEN_URL) {
          removed.push(`template:${session}:${section}:"${item.text}"`);
          item.videoUrl = undefined;
          tDirty = true;
        }
      }
    }
  }

  if (tDirty) {
    await store.writeDocument(templatesKey, tDoc?.templates ? { ...tDoc, templates } : templates);
  }

  // --- Workout days ---
  const wDoc = workoutDoc as Record<string, unknown> | null;
  const days = (wDoc?.days ?? wDoc ?? {}) as Record<string, Record<string, unknown>>;
  let wDirty = false;

  for (const [date, day] of Object.entries(days)) {
    for (const section of ["warmup", "main"] as const) {
      for (const item of (day[section] as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.videoUrl === BROKEN_URL) {
          removed.push(`workout:${date}:${section}:"${item.text}"`);
          item.videoUrl = undefined;
          wDirty = true;
        }
      }
    }
  }

  if (wDirty) {
    await store.writeDocument(workoutKey, wDoc?.days ? { ...wDoc, days } : days);
  }

  // Debug: find all videoUrls actually present
  const found: string[] = [];
  for (const [session, tpl] of Object.entries(templates)) {
    if ((tpl as Record<string, unknown>).videoUrl) found.push(`t:${session}:session="${(tpl as Record<string, unknown>).videoUrl}"`);
    for (const section of ["warmup", "main"] as const) {
      for (const item of (tpl[section] as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.videoUrl) found.push(`t:${session}:${section}:"${item.text}"="${item.videoUrl}"`);
      }
    }
  }

  res.status(200).json({ ok: true, removed, found, brokenUrl: BROKEN_URL, match: found.some(f => f.includes(BROKEN_URL)) });
}
