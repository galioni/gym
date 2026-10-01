import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { requireAuth } from "./_lib/authContext.js";
import { getEnabledProviders, type AiProvider } from "./_lib/apiEnv.js";
import { getUserSettings, setAiProvider } from "./_lib/userSettingsStore.js";
import { resolveAiProvider } from "./_lib/aiProvider.js";
import { getSubscription, hasProAccess } from "./_lib/subscriptionGuard.js";

const VALID_PROVIDERS = new Set<string>(["google", "anthropic", "openai"]);

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/user-settings");
  setCorsHeaders(req, res);

  if (handlePreflight(req, res)) return;

  if (req.method !== "GET" && req.method !== "PUT") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    if (req.method === "GET") {
      // Report what plan generation will actually use, so the screen never shows a choice that is not in effect.
      const [settings, subscription] = await Promise.all([getUserSettings(auth.userId), getSubscription(auth.userId)]);
      res.status(200).json({
        aiProvider: resolveAiProvider(settings.aiProvider, hasProAccess(subscription), getEnabledProviders()),
      });
      return;
    }

    // PUT — update preferences
    const body = parseJsonBody<{ aiProvider?: unknown }>(req, {});
    const provider = body?.aiProvider;

    if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider)) {
      res.status(400).json({ error: "Invalid aiProvider. Must be: google | anthropic | openai" });
      return;
    }

    const enabledProviders = getEnabledProviders();
    if (!enabledProviders.includes(provider as AiProvider)) {
      res.status(400).json({ error: "That AI provider is not currently available." });
      return;
    }

    if (provider !== "google") {
      const subscription = await getSubscription(auth.userId);
      if (!hasProAccess(subscription)) {
        res.status(402).json({ error: "Selecting a non-default AI provider requires a Pro subscription." });
        return;
      }
    }

    await setAiProvider(auth.userId, provider as AiProvider);

    res.status(200).json({ aiProvider: provider });
  } catch (error) {
    console.error("[user-settings] unhandled error", error instanceof Error ? error.message : String(error));
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
