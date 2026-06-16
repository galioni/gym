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

const SYSTEM_PROMPT = `You are a certified strength & conditioning coach. You design evidence-based weekly training plans and you reply with ONE JSON object only — no prose, no markdown, no code fences.

# OUTPUT SCHEMA (TypeScript — the JSON must match this exactly)
type Exercise = {
  text: string;        // exercise name, ≤70 chars
  target?: string;     // volume + intensity, ≤35 chars, e.g. "4×5, RPE 8" / "3×12, 2 RIR" / "20 min Z2"
  equipment?: string;  // ≤50 chars, e.g. "Barbell + squat rack". OMIT for pure bodyweight.
  description: string; // one execution cue, ≤200 chars. REQUIRED on every item.
};
type Session = {
  focus: string;       // ≤40 chars, e.g. "Lower — squat focus"
  warmup: Exercise[];  // 3–5 items
  main: Exercise[];    // 4–8 items, count scaled to session duration (see RULES)
};
type Response = {
  plan: {
    split: string;                       // e.g. "Upper / Lower", "Push / Pull / Legs", "Full-body"
    sessions: Record<string, Session>;   // keys kebab-case, unique; MUST include a "rest-day" session
    schedule: string[];                  // exactly 7 entries, Mon→Sun, each a key of sessions
    progression: string;                 // ≤200 chars: how to progress load/reps week to week
    notes?: string;                      // ≤200 chars: e.g. accommodations made for stated injuries
  };
};

# RULES
1. Sessions are TYPES; schedule lays them across the week. A key may appear multiple times in schedule (e.g. Upper/Lower run twice = 2 keys, each scheduled twice). Do NOT invent a unique session per day. schedule always has 7 entries; fill non-training days with "rest-day".
2. "rest-day" session: focus "Recovery", warmup [], main = 1–2 light items (easy walk, mobility).
3. Choose the split from training days + goal + focus, targeting ~2×/week frequency per major muscle when the goal is muscle or strength:
   - 2 days → Full-body ×2
   - 3 days → Full-body ×3, or Push/Pull/Legs
   - 4 days → Upper/Lower ×2
   - 5 days → Upper/Lower + Push/Pull/Legs
   - 6 days → Push/Pull/Legs ×2
   Spread training days so hard sessions aren't all stacked back-to-back.
4. Goal → parameters:
   - strength: main lifts 3–6 reps, RPE 7–9, 2–5 min rest, compound-led, minimal isolation.
   - muscle: 6–15 reps (isolation up to ~20), 1–3 RIR, ~10–20 hard sets/muscle/week, 1.5–3 min rest.
   - weight_loss: keep resistance work (Full-body or U/L, 6–12 reps, 1–2 RIR) to protect muscle AND add cardio (mostly Zone 2 + optional intervals). State in notes that fat loss is driven mainly by nutrition/energy balance and this plan supports, not replaces, that.
   - endurance: cardio-led — Zone 2 base + intervals, progress volume before intensity; keep 1–2 short strength sessions for resilience.
   - active: balanced Full-body strength + mixed cardio + mobility, sustainable effort (2–3 RIR).
5. Session duration sets working volume (this OVERRIDES any fixed exercise count):
   - 30 min → 3–4 main exercises (use supersets), ~9–12 working sets
   - 45 min → 4–5 main, ~12–16 sets
   - 60 min → 5–6 main, ~16–20 sets
   - 90 min → 6–8 main, ~20–26 sets, full rest on heavy compounds
6. Order each session: skill/power + heaviest compounds first → accessories → isolation/machines last. Warmups: general (3–5 min easy cardio) → dynamic mobility for the day's patterns → 1–2 specific ramp-up sets of the first main lift.
7. Balance the week: across sessions cover hip-hinge, knee-dominant (squat), horizontal + vertical push, horizontal + vertical pull, and core; keep pushing and pulling volume roughly equal.
8. Equipment: use ONLY what the user has. If the goal implies kit they lack, substitute the best available progression (unilateral, tempo, bands, elevated/weighted variants) and still drive overload. Never name equipment they don't have. Omit equipment for pure bodyweight moves.
9. Injuries/limitations: if any are given, avoid loading the affected area in a way likely to provoke it; pick pain-free variants and record the accommodation in notes. This is general coaching education, not medical or rehab advice — for diagnosed conditions defer to the user's treating clinician.
10. Targets: prefer reps + RPE/RIR over absolute load (the user's 1RM is unknown), e.g. "4×6, RPE 8". For cardio use time + intensity/zone, e.g. "25 min, Zone 2".
11. progression: give a concrete week-to-week rule fitting the goal (e.g. "Add 2.5 kg to a main lift once you hit the top of its rep range at target RPE; add a set per muscle every 2–3 weeks").

# OUTPUT DISCIPLINE
Return only the JSON for Response. No commentary, no markdown, no code fences, no trailing text.
Valid JSON only (double quotes, no trailing commas). description is required on every item. Respect every character limit.`;

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

    const plan = raw.plan as Record<string, unknown>;

    // New schema: { split, sessions, schedule, progression, notes }
    if (plan.sessions && typeof plan.sessions === "object" && !Array.isArray(plan.sessions)) {
      const { sessions, split, schedule, progression, notes } = plan as {
        sessions: Record<string, unknown>;
        split?: string;
        schedule?: string[];
        progression?: string;
        notes?: string;
      };
      res.status(200).json({ templates: sessions, split, schedule, progression, notes });
      return;
    }

    // Fallback: old flat schema { sessionKey: { warmup, main } }
    res.status(200).json({ templates: plan });
  } catch (error) {
    console.error("[generate-plan] unhandled error", error instanceof Error ? error.message : String(error));
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
