import { describe, expect, it, vi } from "vitest";
import { createWorkoutServices } from "./createWorkoutServices";

describe("createWorkoutServices", () => {
  it("creates services when cloud env is configured", () => {
    vi.stubEnv("VITE_SYNC_API_BASE_URL", "https://gym-galioni.vercel.app");
    const services = createWorkoutServices();
    expect(services.workoutDataService).toBeDefined();
    expect(services.templateService).toBeDefined();
    expect(services.syncService).toBeDefined();
  });

  it("fails loudly when cloud env var is missing", () => {
    vi.stubEnv("VITE_SYNC_API_BASE_URL", "");
    expect(() => createWorkoutServices()).toThrow(
      "Missing required env var: VITE_SYNC_API_BASE_URL"
    );
  });
});
