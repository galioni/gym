const ALLOWED_METHODS = new Set(["GET", "PUT", "OPTIONS"]);

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

export function toBearerToken(header: string | string[] | undefined): string | null {
  if (!header) {
    return null;
  }
  const normalized = Array.isArray(header) ? header[0] : header;
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function setCorsHeaders(res: ApiResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
}

export function handlePreflight(req: ApiRequest, res: ApiResponse): boolean {
  if (req.method === "OPTIONS") {
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
