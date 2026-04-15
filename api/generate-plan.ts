import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody, getHeader } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getOpenAiApiKey, getRequiredVercelKvEnv } from "./_lib/apiEnv.js";
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

const SYSTEM_PROMPT = `You are a certified strength and conditioning coach. Generate a personalized weekly workout plan as a JSON object.

The JSON must exactly match this TypeScript type:
type Plan = Record<string, { warmup: Array<{ text: string; target?: string }>; main: Array<{ text: string; target?: string }> }>

Rules:
- Keys are short session names in snake_case (e.g. "push", "pull", "legs", "upper", "lower", "full_body", "cardio", "rest_day")
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
    const kvEnv = getRequiredVercelKvEnv();
    const rateLimit = await checkRateLimit(auth.userId, "generate-plan", kvEnv.kvRestApiUrl, kvEnv.kvRestApiToken, 10, 3600);
    if (!rateLimit.allowed) {
      res.status(429).json({ error: "Too many requests. Try again later.", retryAfter: rateLimit.retryAfterSeconds });
      return;
    }

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

    const openAiAbort = new AbortController();
    const openAiTimeout = setTimeout(() => openAiAbort.abort(), 30_000);

    let openAiResponse: Response;
    try {
      openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getOpenAiApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          temperature: 0.7,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: openAiAbort.signal,
      });
    } finally {
      clearTimeout(openAiTimeout);
    }

    if (!openAiResponse.ok) {
      observation.logUnhandledError(new Error(`OpenAI error: ${openAiResponse.status}`));
      res.status(502).json({ error: "Plan generation failed. Please try again." });
      return;
    }

    const openAiData = await openAiResponse.json() as { choices: Array<{ message: { content: string } }> };
    const raw = JSON.parse(openAiData.choices[0].message.content) as { plan?: unknown };

    if (!raw.plan || typeof raw.plan !== "object" || Array.isArray(raw.plan)) {
      res.status(502).json({ error: "Unexpected response from AI. Please try again." });
      return;
    }

    res.status(200).json({ templates: raw.plan });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
