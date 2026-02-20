export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface FixedWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

interface RateLimitWindowState {
  windowStartMs: number;
  count: number;
}

/**
 * Minimal fixed-window in-memory limiter for API burst protection.
 */
export class FixedWindowRateLimiter {
  private readonly now: () => number;
  private readonly windows = new Map<string, RateLimitWindowState>();

  public constructor(private readonly options: FixedWindowRateLimiterOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  public consume(key: string): RateLimitDecision {
    const now = this.now();
    const existingWindow = this.windows.get(key);
    if (!existingWindow || now - existingWindow.windowStartMs >= this.options.windowMs) {
      this.windows.set(key, { windowStartMs: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existingWindow.count >= this.options.maxRequests) {
      const retryAfterMs = Math.max(
        0,
        existingWindow.windowStartMs + this.options.windowMs - now
      );
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    existingWindow.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
