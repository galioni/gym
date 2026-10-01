import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkoutServices } from "./createWorkoutServices";

describe("createWorkoutServices", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates services when the Supabase env is configured", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("VITE_SUPABASE_REDIRECT_URL", "http://localhost:5180");
    const services = createWorkoutServices();
    expect(services.workoutDataService).toBeDefined();
    expect(services.templateService).toBeDefined();
    expect(services.planService).toBeDefined();
    expect(services.syncService).toBeDefined();
  });

  it("fails loudly when the Supabase env is missing", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(() => createWorkoutServices()).toThrow("Missing required env var: VITE_SUPABASE_URL");
  });
});
