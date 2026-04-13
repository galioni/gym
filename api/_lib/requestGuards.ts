import { ApiRequest, ApiResponse, getHeader } from "./http.js";
import { checkRateLimit, RateLimitDecision } from "./rateLimiter.js";
import { RequiredVercelKvEnv } from "./apiEnv.js";

const DEFAULT_MAX_SYNC_BODY_BYTES = 256 * 1024;

function isJsonContentType(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.split(";")[0]?.trim().toLowerCase();
  return normalized === "application/json";
}

function readRequestBodySize(req: ApiRequest): number {
  const contentLength = getHeader(req, "content-length");
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  if (typeof req.body === "string") {
    return Buffer.byteLength(req.body, "utf8");
  }
  if (typeof req.body === "undefined" || req.body === null) {
    return 0;
  }
  return Buffer.byteLength(JSON.stringify(req.body), "utf8");
}

/**
 * Shared abuse-protection guards for sync API routes.
 */
export class SyncRequestGuards {
  public constructor(
    private readonly kvEnv: RequiredVercelKvEnv,
    private readonly maxSyncBodyBytes: number = DEFAULT_MAX_SYNC_BODY_BYTES
  ) {}

  /**
   * Redis-backed per-user rate limit. Must be called after auth is established.
   */
  public async enforceRateLimit(
    res: ApiResponse,
    userId: string,
    routeKey: string
  ): Promise<boolean> {
    let decision: RateLimitDecision;
    try {
      decision = await checkRateLimit(
        userId,
        routeKey,
        this.kvEnv.kvRestApiUrl,
        this.kvEnv.kvRestApiToken
      );
    } catch {
      // Fail open if rate limiter throws unexpectedly.
      return true;
    }

    if (decision.allowed) {
      return true;
    }
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({ error: "Too many requests" });
    return false;
  }

  public enforcePutJsonContentType(req: ApiRequest, res: ApiResponse): boolean {
    if (req.method !== "PUT") {
      return true;
    }
    if (isJsonContentType(getHeader(req, "content-type"))) {
      return true;
    }
    res.status(415).json({ error: "Unsupported media type. Use application/json." });
    return false;
  }

  public enforcePutBodySize(req: ApiRequest, res: ApiResponse): boolean {
    if (req.method !== "PUT") {
      return true;
    }

    try {
      const bodySize = readRequestBodySize(req);
      if (bodySize <= this.maxSyncBodyBytes) {
        return true;
      }
    } catch {
      res.status(400).json({ error: "Invalid request body." });
      return false;
    }

    res.status(413).json({
      error: `Payload too large. Max allowed size is ${this.maxSyncBodyBytes} bytes.`,
    });
    return false;
  }
}
