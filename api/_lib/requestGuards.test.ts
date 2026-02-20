import { describe, expect, it } from "vitest";
import { ApiRequest, ApiResponse } from "./http";
import { FixedWindowRateLimiter } from "./rateLimiter";
import { SyncRequestGuards } from "./requestGuards";

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

describe("SyncRequestGuards", () => {
  it("rejects PUT requests without application/json content type", () => {
    const guards = new SyncRequestGuards(
      new FixedWindowRateLimiter({ maxRequests: 10, windowMs: 60_000, now: () => 1_000 })
    );
    const req: ApiRequest = {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "{}",
    };
    const { res, state } = createMockResponse();

    const allowed = guards.enforcePutJsonContentType(req, res);

    expect(allowed).toBe(false);
    expect(state.statusCode).toBe(415);
  });

  it("accepts PUT requests with application/json and charset", () => {
    const guards = new SyncRequestGuards(
      new FixedWindowRateLimiter({ maxRequests: 10, windowMs: 60_000, now: () => 1_000 })
    );
    const req: ApiRequest = {
      method: "PUT",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: "{}",
    };
    const { res } = createMockResponse();

    const allowed = guards.enforcePutJsonContentType(req, res);

    expect(allowed).toBe(true);
  });

  it("rejects oversized sync payloads with 413", () => {
    const guards = new SyncRequestGuards(
      new FixedWindowRateLimiter({ maxRequests: 10, windowMs: 60_000, now: () => 1_000 }),
      16
    );
    const req: ApiRequest = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "payload that is too large" }),
    };
    const { res, state } = createMockResponse();

    const allowed = guards.enforcePutBodySize(req, res);

    expect(allowed).toBe(false);
    expect(state.statusCode).toBe(413);
  });

  it("throttles burst requests with 429 and retry-after header", () => {
    let nowMs = 10_000;
    const guards = new SyncRequestGuards(
      new FixedWindowRateLimiter({
        maxRequests: 1,
        windowMs: 1_000,
        now: () => nowMs,
      })
    );
    const req: ApiRequest = {
      method: "GET",
      headers: { "x-forwarded-for": "203.0.113.1" },
    };
    const first = createMockResponse();
    const second = createMockResponse();

    expect(guards.enforceRateLimit(req, first.res, "workout-data")).toBe(true);
    expect(guards.enforceRateLimit(req, second.res, "workout-data")).toBe(false);
    expect(second.state.statusCode).toBe(429);
    expect(Number(second.state.headers["Retry-After"])).toBeGreaterThan(0);

    nowMs = 11_001;
    const third = createMockResponse();
    expect(guards.enforceRateLimit(req, third.res, "workout-data")).toBe(true);
  });
});
