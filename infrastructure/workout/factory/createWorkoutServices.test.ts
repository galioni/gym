import { describe, expect, it, vi } from "vitest";
import { createWorkoutServices } from "./createWorkoutServices";

describe("createWorkoutServices", () => {
  it("creates local services by default", () => {
    const services = createWorkoutServices();
    expect(services.workoutDataService).toBeDefined();
    expect(services.templateService).toBeDefined();
    expect(services.syncService).toBeDefined();
  });

  it("still creates services when cloud env vars are missing", () => {
    vi.stubEnv("VITE_SYNC_API_BASE_URL", "");
    vi.stubEnv("VITE_SYNC_API_KEY", "");
    const services = createWorkoutServices();
    expect(services.syncService).toBeDefined();
  });
});
