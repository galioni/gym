import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_WINDOW_SECONDS = 60;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface FixedWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

interface WindowBucket {
  count: number;
  windowStart: number;
}

/**
 * In-memory fixed-window rate limiter. Suitable for process-local burst protection
 * (e.g. IP-based throttling at the edge). Not shared across serverless instances —
 * use the Postgres-backed checkRateLimit for cross-instance per-user limits.
 */
export class FixedWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, WindowBucket>();

  public constructor(options: FixedWindowRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.now = options.now ?? (() => Date.now());
  }

  public consume(key: string): RateLimitDecision {
    const nowMs = this.now();
    const windowStart = Math.floor(nowMs / this.windowMs) * this.windowMs;

    // Evict stale entries from the previous window to prevent unbounded growth.
    const existing = this.buckets.get(key);
    if (existing && existing.windowStart !== windowStart) {
      this.buckets.delete(key);
    }

    const bucket = this.buckets.get(key);
    if (!bucket) {
      this.buckets.set(key, { count: 1, windowStart });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    if (bucket.count <= this.maxRequests) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const windowEnd = windowStart + this.windowMs;
    const retryAfterSeconds = Math.ceil((windowEnd - nowMs) / 1000);
    return { allowed: false, retryAfterSeconds };
  }
}

/**
 * Per-user rate limit shared by every server instance, kept in Postgres (a sliding log, see the
 * `consume_rate_limit` migration). A call is allowed when fewer than `maxRequests` allowed calls happened in the last
 * `windowSeconds`; the check and the record are one atomic step. Keyed by the authenticated user id, so it is immune to
 * IP spoofing. The caller chooses the limit and window, typically from the plan of the user.
 *
 * Fails open (allows the call, logs an error) if the database cannot be reached: a failed check must not block people,
 * and an outage that reaches this call would already break most of the app.
 */
export async function checkRateLimit(
  userId: string,
  routeKey: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<RateLimitDecision> {
  try {
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_user: userId,
      p_route: routeKey,
      p_max: maxRequests,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; retry_after_seconds?: number } | undefined;
    if (typeof row?.allowed !== "boolean") throw new Error("unexpected response from consume_rate_limit");

    return row.allowed
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: Math.max(1, row.retry_after_seconds ?? 1) };
  } catch (error) {
    console.error("[rateLimiter] rate limit check failed, failing open", { routeKey, error });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
