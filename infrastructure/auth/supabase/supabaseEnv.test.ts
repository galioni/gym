import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRequiredSupabaseClientEnv } from "./supabaseEnv";

describe("getRequiredSupabaseClientEnv redirectUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("VITE_SUPABASE_REDIRECT_URL", "https://production.example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns to the origin the user is on, so a preview does not bounce to production", () => {
    vi.stubGlobal("window", { location: { origin: "https://preview-abc.vercel.app" } });
    expect(getRequiredSupabaseClientEnv().redirectUrl).toBe("https://preview-abc.vercel.app");
  });

  it("falls back to the configured address when there is no browser origin", () => {
    vi.stubGlobal("window", undefined);
    expect(getRequiredSupabaseClientEnv().redirectUrl).toBe("https://production.example.com");
  });
});
