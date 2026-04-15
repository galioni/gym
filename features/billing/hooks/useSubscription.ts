import { useEffect, useState, useCallback } from "react";
import { useAuthSession } from "../../auth/hooks/useAuthSession";

export interface SubscriptionInfo {
  plan: "free" | "pro";
  status: string;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
}

const FREE: SubscriptionInfo = {
  plan: "free",
  status: "inactive",
  stripeCustomerId: null,
  currentPeriodEnd: null,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: SubscriptionInfo; expiresAt: number }>();

function getCached(userId: string): SubscriptionInfo | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(userId); return null; }
  return entry.data;
}

function setCached(userId: string, data: SubscriptionInfo): void {
  cache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface UseSubscriptionResult {
  subscription: SubscriptionInfo;
  isLoading: boolean;
  fetchError: boolean;
  startCheckout: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const { session } = useAuthSession();
  const [subscription, setSubscription] = useState<SubscriptionInfo>(FREE);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setFetchError(false);

    const cached = getCached(session.user.id);
    if (cached) {
      setSubscription(cached);
      setIsLoading(false);
      return;
    }

    fetch("/api/subscription", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          const info = data as SubscriptionInfo;
          setCached(session.user.id, info);
          setSubscription(info);
        }
      })
      .catch((error) => {
        console.error("[useSubscription] Failed to fetch subscription status", error);
        if (!cancelled) setFetchError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const startCheckout = useCallback(async () => {
    if (!session) return;
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        successUrl: `${window.location.origin}?checkout=success`,
        cancelUrl: window.location.href,
      }),
    });
    if (!res.ok) throw new Error("Failed to create checkout session.");
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  }, [session]);

  const openBillingPortal = useCallback(async () => {
    if (!session) return;
    const res = await fetch("/api/billing-portal", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ returnUrl: window.location.href }),
    });
    if (!res.ok) throw new Error("Failed to open billing portal.");
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  }, [session]);

  return { subscription, isLoading, fetchError, startCheckout, openBillingPortal };
}
