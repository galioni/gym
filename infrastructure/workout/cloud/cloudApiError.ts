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