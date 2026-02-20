const ALLOWED_METHODS = new Set(["GET", "PUT", "OPTIONS"]);
const DEFAULT_ALLOWED_CORS_ORIGINS = new Set([
  "http://localhost:5173",
  "https://gym-galioni.vercel.app",
]);

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

function readHeaderValue(header: string | string[] | undefined): string | null {
  if (!header) {
    return null;
  }
  return Array.isArray(header) ? header[0] : header;
}

function getRequestOrigin(req: ApiRequest): string | null {
  const rawOrigin = readHeaderValue(req.headers?.origin);
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

export function toBearerToken(header: string | string[] | undefined): string | null {
  if (!header) {
    return null;
  }
  const normalized = Array.isArray(header) ? header[0] : header;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
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
