import { describe, expect, it } from "vitest";
import { SyncService } from "./SyncService";
import { SyncSettings, SyncSettingsRepository } from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { WorkoutDataSnapshot, TemplateSnapshot, PlansSnapshot } from "./syncTypes";
import { Plan } from "../../types";
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
    plans?: unknown;
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

  public async writeRestorePoints(points: Array<{ id: string; createdAt: string; workoutData: unknown; templates: unknown; plans?: unknown }>) {
    this.restorePoints = points;
  }
}

class InMemoryPlansRepository implements PlansRepository {
  public constructor(private snapshot: PlansSnapshot | null) {}

  public async readPlans(): Promise<Plan[]> {
    return this.snapshot?.data ?? [];
  }

  public async writePlans(plans: Plan[]): Promise<void> {
    this.snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: plans,
    };
  }

  public async readActivePlanId(): Promise<string | null> {
    return null;
  }

  public async writeActivePlanId(_id: string | null): Promise<void> {}

  public async readSnapshot(): Promise<PlansSnapshot | null> {
    return this.snapshot;
  }

  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}

describe("SyncService", () => {
  it("returns error when cloud repositories are unavailable", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    settingsRepository.settings = {
      mode: "cloud",
      lastSyncedAt: null,
      lastError: "Previous cloud error",
    };

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
    });

    const result = await service.syncNow();

    expect(result.status).toBe("error");
    expect(result.message).toContain("cloud repositories are unavailable");
    expect(settingsRepository.settings.lastSyncedAt).toBeNull();
    expect(settingsRepository.settings.lastError).toContain("cloud repositories are unavailable");
  });

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

  it("returns conflict for templates when only template snapshots differ", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localTemplateRepository = new InMemoryTemplateRepository({
      version: 1,
      updatedAt: "2026-02-18T08:00:00.000Z",
      data: { ...TEMPLATES, gym: { warmup: [{ text: "Local exercise", target: "" }], main: [] } },
    });
    const cloudTemplateRepository = new InMemoryTemplateRepository({
      version: 1,
      updatedAt: "2026-02-18T09:00:00.000Z",
      data: { ...TEMPLATES, gym: { warmup: [{ text: "Cloud exercise", target: "" }], main: [] } },
    });

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository,
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository,
    });

    const result = await service.syncNow();

    expect(result.status).toBe("conflict");
    expect(result.conflicts[0].entity).toBe("templates");
    expect(result.conflicts[0].previewPaths.length).toBeGreaterThan(0);
  });

  it("pushes local snapshot to cloud when cloud is empty (one-sided local)", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localSnapshot: TemplateSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T10:00:00.000Z",
      data: TEMPLATES,
    };
    const localTemplateRepository = new InMemoryTemplateRepository(localSnapshot);
    const cloudTemplateRepository = new InMemoryTemplateRepository(null);

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository,
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository,
    });

    const result = await service.syncNow();

    expect(result.status).toBe("success");
    expect(await cloudTemplateRepository.readSnapshot()).toMatchObject({ data: TEMPLATES });
  });

  it("detects plans conflict when local and cloud plans differ", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localPlans: PlansSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T08:00:00.000Z",
      data: [{ id: "p1", label: "Push/Pull", sessionIds: ["push", "pull"] }],
    };
    const cloudPlans: PlansSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T09:00:00.000Z",
      data: [{ id: "p1", label: "Push/Pull/Legs", sessionIds: ["push", "pull", "legs"] }],
    };

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository: new InMemoryTemplateRepository(null),
      localPlansRepository: new InMemoryPlansRepository(localPlans),
      cloudPlansRepository: new InMemoryPlansRepository(cloudPlans),
    });

    const result = await service.syncNow();

    expect(result.status).toBe("conflict");
    expect(result.conflicts[0].entity).toBe("plans");
    expect(result.conflicts[0].previewPaths.length).toBeGreaterThan(0);
  });

  it("restore point includes plans snapshot", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localPlans: PlansSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T08:00:00.000Z",
      data: [{ id: "p1", label: "My Plan", sessionIds: ["gym"] }],
    };
    const cloudPlans: PlansSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T08:00:00.000Z",
      data: [{ id: "p1", label: "My Plan", sessionIds: ["gym"] }],
    };

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository: new InMemoryTemplateRepository(null),
      localPlansRepository: new InMemoryPlansRepository(localPlans),
      cloudPlansRepository: new InMemoryPlansRepository(cloudPlans),
    });

    await service.syncNow();

    expect(settingsRepository.restorePoints.length).toBe(1);
    const point = settingsRepository.restorePoints[0];
    expect((point.plans as PlansSnapshot | null)?.data[0].label).toBe("My Plan");
  });

  it("rollback restores plans from restore point", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const originalPlans: PlansSnapshot = {
      version: 1,
      updatedAt: "2026-02-18T10:00:00.000Z",
      data: [{ id: "p1", label: "Original Plan", sessionIds: ["gym"] }],
    };
    const localPlansRepo = new InMemoryPlansRepository(originalPlans);
    const cloudPlansRepo = new InMemoryPlansRepository(originalPlans);

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository: new InMemoryTemplateRepository(null),
      localPlansRepository: localPlansRepo,
      cloudPlansRepository: cloudPlansRepo,
    });

    // Sync creates a restore point
    await service.syncNow();
    const restorePointId = settingsRepository.restorePoints[0]?.id;
    expect(restorePointId).toBeTruthy();

    // Overwrite local plans with new data
    await localPlansRepo.writeSnapshot({
      version: 2,
      updatedAt: "2026-02-18T11:00:00.000Z",
      data: [{ id: "p1", label: "Modified Plan", sessionIds: ["gym", "cardio"] }],
    });

    // Rollback should restore the original plans
    const rollbackResult = await service.rollbackToRestorePoint(restorePointId);
    expect(rollbackResult.status).toBe("success");
    const restoredPlans = await localPlansRepo.readSnapshot();
    expect(restoredPlans?.data[0].label).toBe("Original Plan");
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
