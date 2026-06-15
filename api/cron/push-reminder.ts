import webPush from "web-push";
import { getRequiredVercelKvEnv, getVapidKeys, getCronSecret } from "../_lib/apiEnv.js";
import {
  getAllSubscriberIds,
  getPushSubscription,
  deletePushSubscription,
  checkAndMarkSent,
} from "../_lib/pushKv.js";
import { ApiRequest, ApiResponse } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Verify cron secret — Vercel injects this automatically for cron jobs
  const cronSecret = getCronSecret();
  if (cronSecret) {
    const authHeader = req.headers?.["authorization"];
    const token = Array.isArray(authHeader) ? authHeader[0] : (authHeader ?? "");
    if (token !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const vapidKeys = getVapidKeys();
  if (!vapidKeys) {
    res.status(200).json({ skipped: true, reason: "VAPID not configured" });
    return;
  }

  webPush.setVapidDetails(vapidKeys.subject, vapidKeys.publicKey, vapidKeys.privateKey);

  const env = getRequiredVercelKvEnv();
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const currentWindowMinute = utcHour * 60 + (utcMinute < 30 ? 0 : 30);
  const dateStr = now.toISOString().slice(0, 10);

  const subscriberIds = await getAllSubscriberIds(env);

  let sent = 0;
  let skipped = 0;
  let removed = 0;

  await Promise.all(
    subscriberIds.map(async (userId) => {
      const record = await getPushSubscription(env, userId);
      if (!record) return;
      if (record.reminderMinuteUtc !== currentWindowMinute) return;

      const canSend = await checkAndMarkSent(env, userId, dateStr);
      if (!canSend) {
        skipped += 1;
        return;
      }

      try {
        await webPush.sendNotification(
          {
            endpoint: record.endpoint,
            expirationTime: record.expirationTime ?? null,
            keys: record.keys,
          },
          JSON.stringify({
            title: "Daily Grind",
            body: "Time to log today's workout!",
            url: "/",
          })
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or unregistered — clean it up
          await deletePushSubscription(env, userId);
          removed += 1;
        }
        // Other errors: leave the subscription in place and try again next hour
      }
    })
  );

  res.status(200).json({ ok: true, sent, skipped, removed });
}
