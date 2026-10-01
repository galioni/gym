import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequiredApiEnv } from "./apiEnv";

describe("apiEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails fast when a required variable is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(() => getRequiredApiEnv("SUPABASE_URL")).toThrow(
      "Missing required env var: SUPABASE_URL"
    );
  });
});