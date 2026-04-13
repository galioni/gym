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

interface UseSubscriptionResult {
  subscription: SubscriptionInfo;
  isLoading: boolean;
  startCheckout: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const { session } = useAuthSession();
  const [subscription, setSubscription] = useState<SubscriptionInfo>(FREE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    fetch("/api/subscription", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSubscription(data as SubscriptionInfo);
      })
      .catch(() => {})
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

  return { subscription, isLoading, startCheckout, openBillingPortal };
}
