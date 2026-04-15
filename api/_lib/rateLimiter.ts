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
 * use the Redis-backed checkRateLimit for cross-instance per-user limits.
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
 * Redis-backed fixed-window rate limiter using Upstash REST pipeline.
 * Keyed per authenticated user ID — immune to IP spoofing.
 */
export async function checkRateLimit(
  userId: string,
  routeKey: string,
  kvRestApiUrl: string,
  kvRestApiToken: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowSeconds = DEFAULT_WINDOW_SECONDS
): Promise<RateLimitDecision> {
  const windowSlot = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${routeKey}:${userId}:${windowSlot}`;

  try {
    const response = await fetch(`${kvRestApiUrl}/pipeline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${kvRestApiToken}`,
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSeconds * 2)],
      ]),
    });

    if (!response.ok) {
      // If Redis is unavailable, fail open rather than blocking all users.
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const results = (await response.json()) as [{ result: number }, unknown];
    const count = results[0]?.result ?? 0;

    if (count <= maxRequests) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const windowEndMs = (windowSlot + 1) * windowSeconds * 1000;
    const retryAfterSeconds = Math.ceil((windowEndMs - Date.now()) / 1000);
    return { allowed: false, retryAfterSeconds };
  } catch {
    // Network failure — fail open.
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
