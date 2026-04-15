import { createHash, randomUUID } from "node:crypto";
import { ApiRequest, ApiResponse, getHeader } from "./http.js";

interface ObservabilityLogger {
  info: (message?: unknown, ...optionalParams: Array<unknown>) => void;
  error: (message?: unknown, ...optionalParams: Array<unknown>) => void;
}

interface ApiRequestObservabilityOptions {
  now?: () => number;
  requestIdFactory?: () => string;
  logger?: ObservabilityLogger;
}

interface RequestLifecycleLog {
  event: "api.request.completed";
  requestId: string;
  endpoint: string;
  method: string;
  status: number;
  latencyMs: number;
  userIdHash: string | null;
}

interface RequestErrorLog {
  event: "api.request.error";
  requestId: string;
  endpoint: string;
  method: string;
  userIdHash: string | null;
  errorName: string;
  errorMessage: string;
}

export interface ApiRequestObservation {
  requestId: string;
  setUserId: (userId: string) => void;
  logUnhandledError: (error: unknown) => void;
}

function toUserIdHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

function toErrorMetadata(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return {
    errorName: "UnknownError",
    errorMessage: String(error),
  };
}

function toStatusCode(statusCode: number | null): number {
  return typeof statusCode === "number" ? statusCode : 200;
}

/**
 * Attaches structured request logging to the API response lifecycle.
 */
export function attachApiRequestObservability(
  req: ApiRequest,
  res: ApiResponse,
  endpoint: string,
  options: ApiRequestObservabilityOptions = {}
): ApiRequestObservation {
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? console;
  const incomingRequestId = getHeader(req, "x-request-id");
  const requestId = incomingRequestId ?? (options.requestIdFactory ?? randomUUID)();
  const method = req.method ?? "UNKNOWN";
  const startTimeMs = now();
  let responseLogged = false;
  let statusCode: number | null = null;
  let userIdHash: string | null = null;

  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  const originalSetHeader = res.setHeader.bind(res);

  res.status = (code: number): ApiResponse => {
    statusCode = code;
    return originalStatus(code);
  };

  res.json = (payload: unknown): void => {
    originalJson(payload);
    if (responseLogged) {
      return;
    }

    const entry: RequestLifecycleLog = {
      event: "api.request.completed",
      requestId,
      endpoint,
      method,
      status: toStatusCode(statusCode),
      latencyMs: Math.max(0, now() - startTimeMs),
      userIdHash,
    };
    if (entry.status >= 500) {
      logger.error(JSON.stringify(entry));
    } else {
      logger.info(JSON.stringify(entry));
    }
    responseLogged = true;
  };

  // Echo request id to simplify request->log correlation for API clients.
  originalSetHeader("x-request-id", requestId);

  return {
    requestId,
    setUserId(userId: string) {
      userIdHash = toUserIdHash(userId);
    },
    logUnhandledError(error: unknown) {
      const metadata = toErrorMetadata(error);
      const entry: RequestErrorLog = {
        event: "api.request.error",
        requestId,
        endpoint,
        method,
        userIdHash,
        errorName: metadata.errorName,
        errorMessage: metadata.errorMessage,
      };
      logger.error(JSON.stringify(entry));
    },
  };
}
