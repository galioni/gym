import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequiredApiEnv, getRequiredVercelKvEnv } from "./apiEnv";

describe("apiEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers KV_REST_API_* when both primary and STORAGE_KV_* vars are set", () => {
    vi.stubEnv("KV_REST_API_URL", "https://primary.example.com");
    vi.stubEnv("KV_REST_API_TOKEN", "primary-token");
    vi.stubEnv("STORAGE_KV_REST_API_URL", "https://alias.example.com");
    vi.stubEnv("STORAGE_KV_REST_API_TOKEN", "alias-token");

    expect(getRequiredVercelKvEnv()).toEqual({
      kvRestApiUrl: "https://primary.example.com",
      kvRestApiToken: "primary-token",
    });
  });

  it("falls back to STORAGE_KV_* when KV_REST_API_* vars are missing", () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("STORAGE_KV_REST_API_URL", "https://alias.example.com");
    vi.stubEnv("STORAGE_KV_REST_API_TOKEN", "alias-token");

    expect(getRequiredVercelKvEnv()).toEqual({
      kvRestApiUrl: "https://alias.example.com",
      kvRestApiToken: "alias-token",
    });
  });

  it("keeps non-KV env lookups strict", () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(() => getRequiredApiEnv("SUPABASE_URL")).toThrow(
      "Missing required env var: SUPABASE_URL"
    );
  });
});