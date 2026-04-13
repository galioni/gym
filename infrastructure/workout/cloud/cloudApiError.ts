interface CloudApiErrorPayload {
  error?: unknown;
  requestId?: unknown;
}

function readHeader(response: Response, name: string): string | null {
  return response.headers.get(name);
}

async function readPayload(response: Response): Promise<CloudApiErrorPayload | null> {
  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as CloudApiErrorPayload;
  } catch {
    return { error: rawBody };
  }
}

/**
 * Wraps fetch with an AbortController timeout. Throws a DOMException on timeout.
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id)
  );
}

/**
 * Builds a durable client-facing sync error using the API payload plus request id.
 */
export async function toCloudApiError(
  response: Response,
  operationLabel: string
): Promise<Error> {
  const payload = await readPayload(response);
  const requestId =
    readHeader(response, "x-request-id") ??
    (typeof payload?.requestId === "string" ? payload.requestId : null);
  const apiMessage = typeof payload?.error === "string" ? payload.error : null;

  const parts = [`${operationLabel} failed: ${response.status}`];
  if (apiMessage) {
    parts.push(apiMessage);
  }
  if (requestId) {
    parts.push(`requestId=${requestId}`);
  }

  return new Error(parts.join(" | "));
}