import { useState, useEffect, useCallback } from "react";
import { useAuthSession } from "../../auth/hooks/useAuthSession";

export type AiProvider = "google" | "anthropic" | "openai";

export interface UseUserSettingsResult {
  aiProvider: AiProvider;
  enabledProviders: AiProvider[];
  isLoading: boolean;
  setAiProvider: (provider: AiProvider) => Promise<void>;
}

export function useUserSettings(): UseUserSettingsResult {
  const { session } = useAuthSession();
  // null = not yet fetched for this session; derive isLoading from this
  const [aiProvider, setAiProviderState] = useState<AiProvider | null>(null);
  const [enabledProviders, setEnabledProviders] = useState<AiProvider[]>(["google"]);

  const isLoading = Boolean(session) && aiProvider === null;

  useEffect(() => {
    fetch("/api/ai-config")
      .then((r) => (r.ok ? r.json() : { enabledProviders: ["google"] }))
      .then((data) => {
        const providers = (data as { enabledProviders: AiProvider[] }).enabledProviders;
        setEnabledProviders(Array.isArray(providers) && providers.length > 0 ? providers : ["google"]);
      })
      .catch(() => setEnabledProviders(["google"]));
  }, []);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    fetch("/api/user-settings", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : { aiProvider: "google" }))
      .then((data) => {
        if (!cancelled) {
          setAiProviderState((data as { aiProvider: AiProvider }).aiProvider ?? "google");
        }
      })
      .catch(() => {
        if (!cancelled) setAiProviderState("google");
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const setAiProvider = useCallback(
    async (provider: AiProvider) => {
      if (!session) return;
      const previous = aiProvider ?? "google";
      setAiProviderState(provider);
      try {
        const res = await fetch("/api/user-settings", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ aiProvider: provider }),
        });
        if (!res.ok) {
          setAiProviderState(previous);
        }
      } catch {
        setAiProviderState(previous);
      }
    },
    [session, aiProvider]
  );

  return { aiProvider: aiProvider ?? "google", enabledProviders, isLoading, setAiProvider };
}
