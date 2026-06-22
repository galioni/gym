// One-time admin endpoint — will be removed after use.
// Auth: Authorization: Bearer <CRON_SECRET>
import { VercelKvCloudDocumentStore } from "./_lib/vercelKvCloudDocumentStore.js";
import { getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { ApiRequest, ApiResponse, setCorsHeaders } from "./_lib/http.js";

const USER_ID = "26cdb4b3-c5aa-4c49-a8b5-58c800ca11a0";
const CORRECT_URL = "https://www.youtube.com/watch?v=xT7TkTHHWJI";
const YOUTUBE_URL_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

function isValid(url: string) {
  return YOUTUBE_URL_RE.test(url);
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCorsHeaders(req, res);

  const secret = process.env.SYNC_API_KEY ?? process.env.VITE_SYNC_API_KEY ?? "";
  const auth = (req.headers?.["authorization"] as string | undefined) ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const kvEnv = getRequiredVercelKvEnv();
  const store = new VercelKvCloudDocumentStore(kvEnv);

  const templatesKey = `sync:${USER_ID}:templates`;
  const workoutKey   = `sync:${USER_ID}:workout-data`;

  const [templateDoc, workoutDoc] = await Promise.all([
    store.readDocument(templatesKey),
    store.readDocument(workoutKey),
  ]);

  const fixes: string[] = [];

  // --- Fix templates ---
  const tDoc = templateDoc as Record<string, unknown> | null;
  const rawTemplates = (tDoc?.templates ?? tDoc ?? {}) as Record<string, Record<string, unknown>>;
  let templateDirty = false;

  for (const [session, tpl] of Object.entries(rawTemplates)) {
    for (const section of ["warmup", "main"] as const) {
      const rows = (tpl[section] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const item of rows) {
        if (typeof item.videoUrl === "string" && item.videoUrl.length > 0 && !isValid(item.videoUrl)) {
          fixes.push(`template:${session}:${section}:${item.text} — was "${item.videoUrl}"`);
          item.videoUrl = CORRECT_URL;
          templateDirty = true;
        }
      }
    }
  }

  if (templateDirty) {
    const next = tDoc?.templates ? { ...tDoc, templates: rawTemplates } : rawTemplates;
    await store.writeDocument(templatesKey, next);
  }

  // --- Fix workout-data ---
  const wDoc = workoutDoc as Record<string, unknown> | null;
  const rawDays = (wDoc?.days ?? wDoc ?? {}) as Record<string, Record<string, unknown>>;
  let workoutDirty = false;

  for (const [date, day] of Object.entries(rawDays)) {
    for (const section of ["warmup", "main"] as const) {
      const rows = (day[section] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const item of rows) {
        if (typeof item.videoUrl === "string" && item.videoUrl.length > 0 && !isValid(item.videoUrl)) {
          fixes.push(`workout:${date}:${section}:${item.text} — was "${item.videoUrl}"`);
          item.videoUrl = CORRECT_URL;
          workoutDirty = true;
        }
      }
    }
  }

  if (workoutDirty) {
    const next = wDoc?.days ? { ...wDoc, days: rawDays } : rawDays;
    await store.writeDocument(workoutKey, next);
  }

  // Also report all existing videoUrls to help diagnose
  const allLinks: string[] = [];
  for (const [session, tpl] of Object.entries(rawTemplates)) {
    if ((tpl as Record<string, unknown>).videoUrl) allLinks.push(`template:${session}:session = "${(tpl as Record<string, unknown>).videoUrl}"`);
    for (const section of ["warmup", "main"] as const) {
      for (const item of ((tpl as Record<string, unknown>)[section] as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.videoUrl) allLinks.push(`template:${session}:${section}:"${item.text}" = "${item.videoUrl}"`);
      }
    }
  }
  for (const [date, day] of Object.entries(rawDays)) {
    for (const section of ["warmup", "main"] as const) {
      for (const item of ((day as Record<string, unknown>)[section] as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.videoUrl) allLinks.push(`workout:${date}:${section}:"${item.text}" = "${item.videoUrl}"`);
      }
    }
  }

  res.status(200).json({
    ok: true,
    fixes,
    allLinks,
    correctedTo: CORRECT_URL,
  });
}
