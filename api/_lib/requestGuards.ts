import { ApiRequest, ApiResponse, getHeader } from "./http.js";
import { FixedWindowRateLimiter } from "./rateLimiter.js";

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

function getClientIp(req: ApiRequest): string {
  // Vercel appends the real client IP as the last entry in x-forwarded-for.
  // Taking [0] would allow spoofing by a client sending a forged header value.
  const forwarded = getHeader(req, "x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",");
    return ips[ips.length - 1]?.trim() ?? "unknown";
  }
  return getHeader(req, "x-real-ip") ?? "unknown";
}

/**
 * Shared abuse-protection guards for sync API routes.
 * Uses an in-memory FixedWindowRateLimiter for IP-based burst protection.
 * For per-user cross-instance limits use the Redis-backed checkRateLimit in your handler.
 */
export class SyncRequestGuards {
  public constructor(
    private readonly rateLimiter: FixedWindowRateLimiter,
    private readonly maxSyncBodyBytes: number = DEFAULT_MAX_SYNC_BODY_BYTES
  ) {}

  /**
   * In-memory IP-based burst rate limit. Synchronous.
   */
  public enforceRateLimit(req: ApiRequest, res: ApiResponse, routeKey: string): boolean {
    const ip = getClientIp(req);
    const key = `${routeKey}:${ip}`;
    const decision = this.rateLimiter.consume(key);

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
