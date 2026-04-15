import { ApiRequest, ApiResponse } from "./http";

export interface MockResponseState {
  statusCode: number | null;
  jsonPayload: unknown;
  headers: Record<string, string>;
}

export function createMockRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: "GET",
    headers: {},
    body: undefined,
    ...overrides,
  };
}

export function createMockResponse(): { res: ApiResponse; state: MockResponseState } {
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

export function bearerRequest(token: string, overrides: Partial<ApiRequest> = {}): ApiRequest {
  return createMockRequest({
    ...overrides,
    headers: { authorization: `Bearer ${token}`, ...(overrides.headers ?? {}) },
  });
}
