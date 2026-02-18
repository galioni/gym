import { describe, expect, it, vi } from "vitest";
import { WorkoutDataService } from "./WorkoutDataService";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { createEmptyDay } from "../../utils";

describe("WorkoutDataService", () => {
  it("loads data through repository interface", async () => {
    const payload = {
      "2026-02-17": createEmptyDay("2026-02-17", "tennis"),
    };
    const repository: WorkoutDataRepository = {
      readAll: vi.fn().mockResolvedValue(payload),
      writeAll: vi.fn().mockResolvedValue(undefined),
      readSnapshot: vi.fn().mockResolvedValue(null),
      writeSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const service = new WorkoutDataService(repository);

    const loaded = await service.loadAllData();

    expect(repository.readAll).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual(payload);
  });

  it("saves data through repository interface", async () => {
    const payload = {
      "2026-02-17": createEmptyDay("2026-02-17", "gym"),
    };
    const repository: WorkoutDataRepository = {
      readAll: vi.fn().mockResolvedValue({}),
      writeAll: vi.fn().mockResolvedValue(undefined),
      readSnapshot: vi.fn().mockResolvedValue(null),
      writeSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const service = new WorkoutDataService(repository);

    await service.saveAllData(payload);

    expect(repository.writeAll).toHaveBeenCalledTimes(1);
    expect(repository.writeAll).toHaveBeenCalledWith(payload);
  });
});
