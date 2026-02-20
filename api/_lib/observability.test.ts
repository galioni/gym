import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "./http";
import { attachApiRequestObservability } from "./observability";

interface MockResponseState {
  statusCode: number | null;
  jsonPayload: unknown;
  headers: Record<string, string>;
}

function createMockResponse(): { res: ApiResponse; state: MockResponseState } {
  const state: MockResponseState = {
    statusCode: null,
    jsonPayload: null,
    headers: {},
  };

  const res: ApiResponse = {
    status(statusCode: number) {
      state.statusCode = statusCode;
      return this;
    },
    json(payload: unknown) {
      state.jsonPayload = payload;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
  };

  return { res, state };
}

describe("attachApiRequestObservability", () => {
  it("logs completed request lifecycle with request metadata", () => {
    let nowMs = 1_000;
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const req: ApiRequest = {
      method: "GET",
      headers: {
        "x-request-id": "req-abc-123",
      },
    };
    const { res, state } = createMockResponse();
    attachApiRequestObservability(req, res, "/api/workout-data", {
      now: () => nowMs,
      logger,
      requestIdFactory: () => "unused",
    });

    nowMs = 1_025;
    res.status(200).json({ ok: true });

    expect(state.headers["x-request-id"]).toBe("req-abc-123");
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logger.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(payload.event).toBe("api.request.completed");
    expect(payload.requestId).toBe("req-abc-123");
    expect(payload.endpoint).toBe("/api/workout-data");
    expect(payload.status).toBe(200);
    expect(payload.latencyMs).toBe(25);
  });

  it("hashes authenticated user id and logs unhandled errors", () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const req: ApiRequest = {
      method: "PUT",
      headers: {},
    };
    const { res } = createMockResponse();
    const observation = attachApiRequestObservability(req, res, "/api/templates", {
      logger,
      requestIdFactory: () => "req-generated",
    });
    observation.setUserId("user-123");
    observation.logUnhandledError(new Error("Boom"));
    res.status(500).json({ error: "Internal server error" });

    expect(logger.error).toHaveBeenCalledTimes(2);
    const errorEntry = JSON.parse(logger.error.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(errorEntry.event).toBe("api.request.error");
    expect(errorEntry.requestId).toBe("req-generated");
    expect(errorEntry.errorMessage).toBe("Boom");
    expect(errorEntry.userIdHash).not.toBe("user-123");

    const lifecycleEntry = JSON.parse(
      logger.error.mock.calls[1]?.[0] as string
    ) as Record<string, unknown>;
    expect(lifecycleEntry.event).toBe("api.request.completed");
    expect(lifecycleEntry.status).toBe(500);
    expect((lifecycleEntry.userIdHash as string).length).toBe(16);
  });
});
