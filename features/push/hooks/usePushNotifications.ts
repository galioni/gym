import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthSession } from "../../auth/hooks/useAuthSession";

export interface PushNotificationState {
  isSupported: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  reminderMinuteLocal: number | null;
  isLoading: boolean;
  error: string | null;
}

export interface UsePushNotifications extends PushNotificationState {
  subscribe: (minuteLocal: number) => Promise<void>;
  unsubscribe: () => Promise<void>;
  updateReminderMinute: (minuteLocal: number) => Promise<void>;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function localToUtcMinute(minuteLocal: number): number {
  const offsetMinutes = new Date().getTimezoneOffset();
  return ((minuteLocal + offsetMinutes) % (24 * 60) + 24 * 60) % (24 * 60);
}

function utcToLocalMinute(minuteUtc: number): number {
  const offsetMinutes = new Date().getTimezoneOffset();
  return ((minuteUtc - offsetMinutes) % (24 * 60) + 24 * 60) % (24 * 60);
}

function snapToHalfHour(minutes: number): number {
  return Math.round(minutes / 30) * 30 % (24 * 60);
}

let cachedVapidKey: string | null | undefined;

async function fetchVapidKey(): Promise<string | null> {
  if (cachedVapidKey !== undefined) return cachedVapidKey;
  try {
    const res = await fetch("/api/push-vapid-key");
    if (!res.ok) { cachedVapidKey = null; return null; }
    const data = await res.json() as { publicKey?: string };
    cachedVapidKey = data.publicKey ?? null;
    return cachedVapidKey;
  } catch {
    cachedVapidKey = null;
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr.buffer as ArrayBuffer;
}

export function usePushNotifications(): UsePushNotifications {
  const { session } = useAuthSession();
  const supported = isSupported();

  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : "default"
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [reminderMinuteLocal, setReminderMinuteLocal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(supported);
  const [error, setError] = useState<string | null>(null);

  const initialised = useRef(false);

  useEffect(() => {
    if (!supported || !session || initialised.current) return;
    initialised.current = true;

    void (async () => {
      setIsLoading(true);
      try {
        const [vapidKey, reg] = await Promise.all([
          fetchVapidKey(),
          navigator.serviceWorker.ready,
        ]);
        if (!vapidKey) {
          setIsLoading(false);
          return;
        }

        const browserSub = await reg.pushManager.getSubscription();
        if (!browserSub) {
          setIsSubscribed(false);
          setIsLoading(false);
          return;
        }

        const res = await fetch("/api/push-subscribe", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (res.ok) {
          const data = await res.json() as { subscribed: boolean; reminderMinuteUtc: number | null };
          setIsSubscribed(data.subscribed);
          if (data.subscribed && data.reminderMinuteUtc !== null) {
            setReminderMinuteLocal(snapToHalfHour(utcToLocalMinute(data.reminderMinuteUtc)));
          }
        }
      } catch {
        // Non-critical — leave as not subscribed
      } finally {
        setIsLoading(false);
      }
    })();
  }, [supported, session]);

  const subscribe = useCallback(async (minuteLocal: number) => {
    if (!session) { setError("Sign in to enable push notifications."); return; }
    setIsLoading(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError("Notification permission denied.");
        return;
      }

      const vapidKey = await fetchVapidKey();
      if (!vapidKey) { setError("Push notifications are not available."); return; }

      const reg = await navigator.serviceWorker.ready;
      const pushSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const subJson = pushSub.toJSON() as {
        endpoint: string;
        expirationTime?: number | null;
        keys?: { p256dh: string; auth: string };
      };

      const res = await fetch("/api/push-subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          subscription: {
            endpoint: subJson.endpoint,
            expirationTime: subJson.expirationTime ?? null,
            keys: subJson.keys,
          },
          reminderMinuteUtc: localToUtcMinute(snapToHalfHour(minuteLocal)),
        }),
      });

      if (!res.ok) throw new Error("Failed to register subscription.");
      setIsSubscribed(true);
      setReminderMinuteLocal(snapToHalfHour(minuteLocal));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications.");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  const unsubscribe = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const pushSub = await reg.pushManager.getSubscription();
      if (pushSub) await pushSub.unsubscribe();

      await fetch("/api/push-subscribe", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      setIsSubscribed(false);
      setReminderMinuteLocal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable notifications.");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  const updateReminderMinute = useCallback(async (minuteLocal: number) => {
    if (!session || !isSubscribed) return;
    setIsLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const pushSub = await reg.pushManager.getSubscription();
      if (!pushSub) { await subscribe(minuteLocal); return; }

      const subJson = pushSub.toJSON() as {
        endpoint: string;
        expirationTime?: number | null;
        keys?: { p256dh: string; auth: string };
      };

      const res = await fetch("/api/push-subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          subscription: {
            endpoint: subJson.endpoint,
            expirationTime: subJson.expirationTime ?? null,
            keys: subJson.keys,
          },
          reminderMinuteUtc: localToUtcMinute(snapToHalfHour(minuteLocal)),
        }),
      });

      if (!res.ok) throw new Error("Failed to update reminder time.");
      setReminderMinuteLocal(snapToHalfHour(minuteLocal));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update reminder time.");
    } finally {
      setIsLoading(false);
    }
  }, [session, isSubscribed, subscribe]);

  return {
    isSupported: supported,
    permission,
    isSubscribed,
    reminderMinuteLocal,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    updateReminderMinute,
  };
}
