import { ApiRequest, ApiResponse, getHeader } from "./http.js";
import { FixedWindowRateLimiter } from "./rateLimiter.js";

const DEFAULT_MAX_SYNC_BODY_BYTES = 256 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 30;

function toClientIdentifier(req: ApiRequest): string {
  const forwardedFor = getHeader(req, "x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return `ip:${firstIp}`;
    }
  }
  const realIp = getHeader(req, "x-real-ip");
  if (realIp) {
    return `ip:${realIp.trim()}`;
  }
  return "ip:unknown";
}

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
    private readonly rateLimiter: FixedWindowRateLimiter,
    private readonly maxSyncBodyBytes: number = DEFAULT_MAX_SYNC_BODY_BYTES
  ) {}

  public enforceRateLimit(req: ApiRequest, res: ApiResponse, routeKey: string): boolean {
    const clientIdentifier = toClientIdentifier(req);
    const decision = this.rateLimiter.consume(`${routeKey}:${clientIdentifier}`);
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

/**
 * Default singleton for stateless route handlers.
 */
export const syncRequestGuards = new SyncRequestGuards(
  new FixedWindowRateLimiter({
    windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    maxRequests: DEFAULT_MAX_REQUESTS_PER_WINDOW,
  })
);
