import { generateText, APICallError, RetryError } from "ai";
import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody, getHeader } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getAiModelForProvider, getEnabledProviders, getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
import { getUserSettings } from "./_lib/userSettingsKv.js";
import { getSubscription, hasProAccess } from "./_lib/subscriptionGuard.js";
import { checkRateLimit, FixedWindowRateLimiter } from "./_lib/rateLimiter.js";

// IP-based burst protection — first line of defense before Redis auth check.
const ipLimiter = new FixedWindowRateLimiter({ maxRequests: 5, windowMs: 60_000 });

const VALID_GOALS = new Set(["strength", "muscle", "weight_loss", "endurance", "active"]);
const VALID_EXPERIENCE = new Set(["beginner", "intermediate", "advanced"]);
const VALID_EQUIPMENT = new Set(["full_gym", "home_gym", "minimal", "bodyweight"]);
const VALID_DURATIONS = new Set(["30", "45", "60", "90"]);
const VALID_BODY_FOCUS = new Set(["full_body", "chest", "back", "shoulders", "arms", "core", "legs", "glutes", "cardio"]);

interface PlanRequest {
  goal: string;
  experience: string;
  daysPerWeek: number;
  equipment: string;
  duration: string;
  bodyFocus: string[];
}

function validate(body: unknown): PlanRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!VALID_GOALS.has(String(b.goal))) return null;
  if (!VALID_EXPERIENCE.has(String(b.experience))) return null;
  if (typeof b.daysPerWeek !== "number" || b.daysPerWeek < 2 || b.daysPerWeek > 6) return null;
  if (!VALID_EQUIPMENT.has(String(b.equipment))) return null;
  if (!VALID_DURATIONS.has(String(b.duration))) return null;
  const rawFocus = b.bodyFocus;
  const bodyFocus: string[] = Array.isArray(rawFocus)
    ? rawFocus.filter((f): f is string => typeof f === "string" && VALID_BODY_FOCUS.has(f))
    : [];
  return {
    goal: String(b.goal),
    experience: String(b.experience),
    daysPerWeek: b.daysPerWeek,
    equipment: String(b.equipment),
    duration: String(b.duration),
    bodyFocus,
  };
}

const GOAL_LABELS: Record<string, string> = {
  strength: "build strength (focus on compound lifts, progressive overload)",
  muscle: "build muscle / hypertrophy (volume-focused, 8-15 rep ranges)",
  weight_loss: "lose weight / body recomposition (mixed cardio + resistance)",
  endurance: "improve cardio and endurance",
  active: "stay active and healthy (general fitness)",
};

const EXPERIENCE_LABELS: Record<string, string> = {
  beginner: "beginner (less than 1 year of consistent training)",
  intermediate: "intermediate (1-3 years)",
  advanced: "advanced (3+ years)",
};

const EQUIPMENT_LABELS: Record<string, string> = {
  full_gym: "full commercial gym (barbells, machines, cables, dumbbells)",
  home_gym: "home gym (dumbbells and barbell only)",
  minimal: "minimal equipment (resistance bands and bodyweight)",
  bodyweight: "bodyweight only",
};

function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

const SYSTEM_PROMPT = `You are a certified strength and conditioning coach. Generate a personalized weekly workout plan as a JSON object.

The JSON must exactly match this TypeScript type:
type Plan = Record<string, { warmup: Array<{ text: string; target?: string }>; main: Array<{ text: string; target?: string }> }>

Rules:
- Keys are short session names in kebab-case (e.g. "push", "pull", "legs", "upper", "lower", "full-body", "cardio", "rest-day")
- Create exactly the number of distinct session types needed to fill the requested training days (e.g. 4 days = 4 keys)
- Include one "rest_day" key with warmup: [] and 1-2 light recovery items in main
- Each non-rest session: 3-5 warmup items and 5-8 main items
- text: exercise name, max 70 characters
- target: sets x reps, duration, or load guidance, max 35 characters (optional but preferred)
- Match the equipment constraint strictly — never prescribe equipment the user doesn't have
- Return ONLY a valid JSON object with a top-level "plan" key containing the sessions`;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/generate-plan");
  setCorsHeaders(req, res);

  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // IP-based burst check before touching auth or KV
  const ip = getHeader(req, "x-forwarded-for") ?? getHeader(req, "x-real-ip") ?? "unknown";
  const ipCheck = ipLimiter.consume(ip);
  if (!ipCheck.allowed) {
    res.status(429).json({ error: "Too many requests. Try again later.", retryAfter: ipCheck.retryAfterSeconds });
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    observation.setUserId(auth.userId);

    // Tight rate limit: 10 per hour per user — each call costs money
    // RATE_LIMIT_BYPASS_USERS: comma-separated user IDs that skip the per-user limit (owner/testing use)
    const bypassUsers = new Set((process.env.RATE_LIMIT_BYPASS_USERS ?? "").split(",").filter(Boolean));
    if (bypassUsers.has(auth.userId)) {
      console.log("[rate-limit] bypassed for user", auth.userId);
    } else {
      const kvEnv = getRequiredVercelKvEnv();
      const rateLimit = await checkRateLimit(auth.userId, "generate-plan", kvEnv.kvRestApiUrl, kvEnv.kvRestApiToken, 10, 3600);
      if (!rateLimit.allowed) {
        res.status(429).json({ error: "Too many requests. Try again later.", retryAfter: rateLimit.retryAfterSeconds });
        return;
      }
    }

    const kvEnv = getRequiredVercelKvEnv();
    const [subscription, userSettings] = await Promise.all([
      getSubscription(auth.userId, kvEnv),
      getUserSettings(auth.userId, kvEnv),
    ]);

    const enabledProviders = getEnabledProviders();
    const isPro = hasProAccess(subscription);
    const requestedProvider = userSettings.aiProvider ?? "google";
    const provider = isPro && enabledProviders.includes(requestedProvider)
      ? requestedProvider
      : "google";

    const body = parseJsonBody<unknown>(req, null);
    const input = validate(body);
    if (!input) {
      res.status(400).json({ error: "Invalid request body." });
      return;
    }

    const bodyFocusLine = input.bodyFocus.length > 0
      ? `- Body focus areas: ${input.bodyFocus.join(", ")}`
      : "- Body focus: balanced / no preference";

    const userPrompt = `Generate a workout plan for:
- Goal: ${GOAL_LABELS[input.goal]}
- Experience: ${EXPERIENCE_LABELS[input.experience]}
- Training days per week: ${input.daysPerWeek}
- Equipment: ${EQUIPMENT_LABELS[input.equipment]}
- Session duration: ${input.duration} minutes
${bodyFocusLine}`;

    let aiText: string;
    try {
      const { text } = await generateText({
        model: getAiModelForProvider(provider),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.7,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(30_000),
      });
      aiText = text;
    } catch (error) {
      const rootError = error instanceof RetryError ? error.lastError : error;
      if (rootError instanceof APICallError && rootError.statusCode === 429) {
        res.status(429).json({ error: "AI plan generation is temporarily unavailable. Please try again in a minute.", retryAfter: 60 });
        return;
      }
      if (rootError instanceof APICallError) {
        console.error("[ai] APICallError", { status: rootError.statusCode, url: rootError.url, body: rootError.responseBody });
      } else {
        console.error("[ai] error", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      }
      observation.logUnhandledError(error);
      res.status(502).json({ error: "Plan generation failed. Please try again." });
      return;
    }

    let raw: { plan?: unknown };
    try {
      raw = JSON.parse(extractJsonString(aiText)) as { plan?: unknown };
    } catch {
      console.error("[ai] JSON parse failed", { preview: aiText.slice(0, 400) });
      res.status(502).json({ error: "Unexpected response from AI. Please try again." });
      return;
    }

    if (!raw.plan || typeof raw.plan !== "object" || Array.isArray(raw.plan)) {
      res.status(502).json({ error: "Unexpected response from AI. Please try again." });
      return;
    }

    res.status(200).json({ templates: raw.plan });
  } catch (error) {
    console.error("[generate-plan] unhandled error", error instanceof Error ? error.message : String(error));
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
