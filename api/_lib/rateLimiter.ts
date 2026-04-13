const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_WINDOW_SECONDS = 60;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
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
