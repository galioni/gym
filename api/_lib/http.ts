const ALLOWED_METHODS = new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS"]);

function buildDefaultAllowedCorsOrigins(): Set<string> {
  const origins = new Set(["http://localhost:5173"]);
  // VERCEL_PROJECT_PRODUCTION_URL is the stable production domain (no protocol prefix)
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  // VERCEL_URL is the deployment-specific domain (preview + production)
  const deployUrl = process.env.VERCEL_URL;
  if (prodUrl) origins.add(`https://${prodUrl}`);
  if (deployUrl) origins.add(`https://${deployUrl}`);
  return origins;
}

const DEFAULT_ALLOWED_CORS_ORIGINS = buildDefaultAllowedCorsOrigins();

export interface ApiRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status: (statusCode: number) => ApiResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

export interface ApiHandlerContext {
  req: ApiRequest;
  res: ApiResponse;
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function readHeaderValue(header: string | string[] | undefined): string | null {
  if (!header) {
    return null;
  }
  return Array.isArray(header) ? header[0] : header;
}

export function getHeader(req: ApiRequest, name: string): string | null {
  if (!req.headers) {
    return null;
  }
  const directMatch = readHeaderValue(req.headers[name]);
  if (directMatch) {
    return directMatch;
  }
  const loweredName = name.toLowerCase();
  for (const [headerName, headerValue] of Object.entries(req.headers)) {
    if (headerName.toLowerCase() === loweredName) {
      return readHeaderValue(headerValue);
    }
  }
  return null;
}

function getRequestOrigin(req: ApiRequest): string | null {
  const rawOrigin = getHeader(req, "origin");
  return rawOrigin ? normalizeOrigin(rawOrigin) : null;
}

function getAllowedCorsOrigins(): Set<string> {
  const fromEnv = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter((value) => value.length > 0);
  return new Set([...DEFAULT_ALLOWED_CORS_ORIGINS, ...fromEnv]);
}

function isOriginAllowed(origin: string): boolean {
  return getAllowedCorsOrigins().has(origin);
}

/**
 * Returns true if the URL's origin matches one of the known allowed origins.
 * Used to validate Stripe return URLs so they can only point back to this app.
 */
export function isAllowedReturnUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const parsed = new URL(raw);
    const origin = normalizeOrigin(`${parsed.protocol}//${parsed.host}`);
    return getAllowedCorsOrigins().has(origin);
  } catch {
    return false;
  }
}

export function toBearerToken(header: string | string[] | undefined): string | null {
  const normalized = readHeaderValue(header);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function setCorsHeaders(req: ApiRequest, res: ApiResponse): void {
  const origin = getRequestOrigin(req);
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "x-request-id");
}

export function handlePreflight(req: ApiRequest, res: ApiResponse): boolean {
  if (req.method === "OPTIONS") {
    const origin = getRequestOrigin(req);
    if (origin && !isOriginAllowed(origin)) {
      res.status(403).json({ error: "CORS origin forbidden" });
      return true;
    }
    res.status(204).json({});
    return true;
  }
  return false;
}

export function enforceMethod(req: ApiRequest, res: ApiResponse): boolean {
  if (!req.method || !ALLOWED_METHODS.has(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return false;
  }
  return true;
}

export function parseJsonBody<T>(req: ApiRequest, fallback: T): T {
  if (!req.body) {
    return fallback;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return fallback;
    }
  }
  return req.body as T;
}