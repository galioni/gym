import { describe, expect, it } from "vitest";
import { SyncService } from "./SyncService";
import { SyncSettings, SyncSettingsRepository } from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { WorkoutDataSnapshot, TemplateSnapshot } from "./syncTypes";
import { createEmptyDay } from "../../utils";
import { TEMPLATES } from "../../constants";

class InMemoryWorkoutRepository implements WorkoutDataRepository {
  public constructor(private snapshot: WorkoutDataSnapshot | null) {}

  public async readAll() {
    return this.snapshot?.data ?? {};
  }

  public async writeAll(data: WorkoutDataSnapshot["data"]) {
    this.snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data,
    };
  }

  public async readSnapshot() {
    return this.snapshot;
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot) {
    this.snapshot = snapshot;
  }
}

class InMemoryTemplateRepository implements TemplateRepository {
  public constructor(private snapshot: TemplateSnapshot | null) {}

  public async readTemplates() {
    return this.snapshot?.data ?? null;
  }

  public async writeTemplates(templates: TemplateSnapshot["data"]) {
    this.snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: templates,
    };
  }

  public async readSnapshot() {
    return this.snapshot;
  }

  public async writeSnapshot(snapshot: TemplateSnapshot) {
    this.snapshot = snapshot;
  }
}

class InMemorySyncSettingsRepository implements SyncSettingsRepository {
  public settings: SyncSettings = { mode: "cloud", lastSyncedAt: null, lastError: null };
  public restorePoints: Array<{
    id: string;
    createdAt: string;
    workoutData: unknown;
    templates: unknown;
  }> = [];

  public async readSettings() {
    return this.settings;
  }

  public async writeSettings(settings: SyncSettings) {
    this.settings = settings;
  }

  public async readRestorePoints() {
    return this.restorePoints;
  }

  public async writeRestorePoints(points: Array<{ id: string; createdAt: string; workoutData: unknown; templates: unknown }>) {
    this.restorePoints = points;
  }
}

describe("SyncService", () => {
  it("returns conflict details when snapshots differ and no resolution is provided", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localWorkoutRepository = new InMemoryWorkoutRepository({
      version: 1,
      updatedAt: "2026-02-18T08:00:00.000Z",
      data: {
        "2026-02-18": createEmptyDay("2026-02-18", "gym"),
      },
    });
    const cloudWorkoutRepository = new InMemoryWorkoutRepository({
      version: 1,
      updatedAt: "2026-02-18T09:00:00.000Z",
      data: {
        "2026-02-18": {
          ...createEmptyDay("2026-02-18", "gym"),
          warmupNotes: "Different",
        },
      },
    });

    const localTemplateRepository = new InMemoryTemplateRepository(null);
    const cloudTemplateRepository = new InMemoryTemplateRepository(null);
    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository,
      localTemplateRepository,
      cloudWorkoutRepository,
      cloudTemplateRepository,
    });

    const result = await service.syncNow();

    expect(result.status).toBe("conflict");
    expect(result.conflicts[0].entity).toBe("workoutData");
    expect(result.conflicts[0].previewPaths.length).toBeGreaterThan(0);
    expect(settingsRepository.restorePoints.length).toBe(1);
  });

  it("applies keepLocal resolution and can rollback from restore point", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localWorkoutSnapshot: WorkoutDataSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T10:00:00.000Z",
      data: {
        "2026-02-18": {
          ...createEmptyDay("2026-02-18", "gym"),
          warmupNotes: "Local copy",
        },
      },
    };
    const cloudWorkoutSnapshot: WorkoutDataSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T09:00:00.000Z",
      data: {
        "2026-02-18": {
          ...createEmptyDay("2026-02-18", "gym"),
          warmupNotes: "Cloud copy",
        },
      },
    };

    const localWorkoutRepository = new InMemoryWorkoutRepository(localWorkoutSnapshot);
    const cloudWorkoutRepository = new InMemoryWorkoutRepository(cloudWorkoutSnapshot);
    const localTemplateRepository = new InMemoryTemplateRepository({
      version: 1,
      updatedAt: "2026-02-18T10:00:00.000Z",
      data: TEMPLATES,
    });
    const cloudTemplateRepository = new InMemoryTemplateRepository({
      version: 1,
      updatedAt: "2026-02-18T10:00:00.000Z",
      data: TEMPLATES,
    });

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository,
      localTemplateRepository,
      cloudWorkoutRepository,
      cloudTemplateRepository,
    });

    const syncResult = await service.syncNow({ workoutData: "keepLocal" });
    expect(syncResult.status).toBe("success");
    expect((await cloudWorkoutRepository.readSnapshot())?.data["2026-02-18"].warmupNotes).toBe("Local copy");

    await localWorkoutRepository.writeSnapshot(cloudWorkoutSnapshot);
    const restorePointId = settingsRepository.restorePoints[0]?.id;
    expect(restorePointId).toBeTruthy();
    const rollbackResult = await service.rollbackToRestorePoint(restorePointId);
    expect(rollbackResult.status).toBe("success");
    expect((await localWorkoutRepository.readSnapshot())?.data["2026-02-18"].warmupNotes).toBe("Local copy");
  });
});
