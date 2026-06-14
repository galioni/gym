import { describe, expect, it } from "vitest";
import { SyncService } from "./SyncService";
import { SyncSettings, SyncSettingsRepository } from "../../interfaces/sync/SyncSettingsRepository";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { WorkoutDataSnapshot, TemplateSnapshot, PlansSnapshot } from "./syncTypes";
import { Plan } from "../../types";
import { TEMPLATES } from "../../constants";
import { createEmptyDay } from "../../utils";

class InMemoryWorkoutRepository implements WorkoutDataRepository {
  public constructor(private snapshot: WorkoutDataSnapshot | null) {}
  public async readAll() { return this.snapshot?.data ?? {}; }
  public async writeAll(data: WorkoutDataSnapshot["data"]) {
    this.snapshot = { version: 1, updatedAt: new Date().toISOString(), data };
  }
  public async readSnapshot() { return this.snapshot; }
  public async writeSnapshot(snapshot: WorkoutDataSnapshot) { this.snapshot = snapshot; }
}

class InMemoryTemplateRepository implements TemplateRepository {
  public constructor(private snapshot: TemplateSnapshot | null) {}
  public async readTemplates() { return this.snapshot?.data ?? null; }
  public async writeTemplates(templates: TemplateSnapshot["data"]) {
    this.snapshot = { version: 1, updatedAt: new Date().toISOString(), data: templates };
  }
  public async readSnapshot() { return this.snapshot; }
  public async writeSnapshot(snapshot: TemplateSnapshot) { this.snapshot = snapshot; }
}

class InMemoryPlansRepository implements PlansRepository {
  public constructor(private snapshot: PlansSnapshot | null) {}
  public async readPlans(): Promise<Plan[]> { return this.snapshot?.data ?? []; }
  public async writePlans(plans: Plan[]): Promise<void> {
    this.snapshot = { version: 1, updatedAt: new Date().toISOString(), data: plans };
  }
  public async readActivePlanId(): Promise<string | null> { return null; }
  public async writeActivePlanId(_id: string | null): Promise<void> {}
  public async readSnapshot(): Promise<PlansSnapshot | null> { return this.snapshot; }
  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> { this.snapshot = snapshot; }
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

  public async readSettings() { return this.settings; }
  public async writeSettings(settings: SyncSettings) { this.settings = settings; }
  public async readRestorePoints() { return this.restorePoints; }
  public async writeRestorePoints(
    points: Array<{ id: string; createdAt: string; workoutData: unknown; templates: unknown; plans?: unknown }>
  ) { this.restorePoints = points; }
}

describe("Restore-point verification", () => {
  it("restore point captures exact pre-sync workout and template snapshots", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localWorkout: WorkoutDataSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T09:00:00.000Z",
      data: { "2026-03-01": createEmptyDay("2026-03-01", "gym") },
    };
    const localTemplates: TemplateSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T09:00:00.000Z",
      data: { ...TEMPLATES, gym: { warmup: [{ text: "Pre-sync exercise", target: "" }], main: [] } },
    };

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(localWorkout),
      localTemplateRepository: new InMemoryTemplateRepository(localTemplates),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(localWorkout),
      cloudTemplateRepository: new InMemoryTemplateRepository(localTemplates),
    });

    await service.syncNow();

    const point = settingsRepository.restorePoints[0];
    expect(point).toBeDefined();
    expect(point.workoutData).toEqual(localWorkout);
    expect(point.templates).toEqual(localTemplates);
  });

  it("restore point captures exact pre-sync plans snapshot", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const localPlans: PlansSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T09:00:00.000Z",
      data: [{ id: "p1", label: "Strength", sessionIds: ["gym"] }],
    };

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository: new InMemoryTemplateRepository(null),
      localPlansRepository: new InMemoryPlansRepository(localPlans),
      cloudPlansRepository: new InMemoryPlansRepository(localPlans),
    });

    await service.syncNow();

    const point = settingsRepository.restorePoints[0];
    expect(point.plans).toEqual(localPlans);
  });

  it("rollback to non-existent ID returns error", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(null),
      cloudTemplateRepository: new InMemoryTemplateRepository(null),
    });

    const result = await service.rollbackToRestorePoint("does-not-exist");

    expect(result.status).toBe("error");
    expect(result.message.toLowerCase()).toContain("not found");
  });

  it("rollback with corrupted workoutData returns error", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    settingsRepository.restorePoints = [
      {
        id: "rp1",
        createdAt: "2026-03-01T10:00:00.000Z",
        workoutData: { version: 1 },
        templates: null,
        plans: null,
      },
    ];

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
    });

    const result = await service.rollbackToRestorePoint("rp1");

    expect(result.status).toBe("error");
    expect(result.message.toLowerCase()).toContain("corrupted");
  });

  it("rollback with corrupted templates returns error", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    settingsRepository.restorePoints = [
      {
        id: "rp1",
        createdAt: "2026-03-01T10:00:00.000Z",
        workoutData: null,
        templates: { version: 1 },
        plans: null,
      },
    ];

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
    });

    const result = await service.rollbackToRestorePoint("rp1");

    expect(result.status).toBe("error");
    expect(result.message.toLowerCase()).toContain("corrupted");
  });

  it("rollback with corrupted plans returns error", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const validWorkout: WorkoutDataSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T10:00:00.000Z",
      data: {},
    };
    const validTemplates: TemplateSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T10:00:00.000Z",
      data: TEMPLATES,
    };
    settingsRepository.restorePoints = [
      {
        id: "rp1",
        createdAt: "2026-03-01T10:00:00.000Z",
        workoutData: validWorkout,
        templates: validTemplates,
        plans: { version: 1, updatedAt: "2026-03-01T10:00:00.000Z" },
      },
    ];

    const localPlansRepo = new InMemoryPlansRepository(null);
    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
      localPlansRepository: localPlansRepo,
    });

    const result = await service.rollbackToRestorePoint("rp1");

    expect(result.status).toBe("error");
    expect(result.message.toLowerCase()).toContain("corrupted");
  });

  it("partial restore point (null workoutData) restores templates without error", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const savedTemplates: TemplateSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T10:00:00.000Z",
      data: { ...TEMPLATES, gym: { warmup: [{ text: "Saved exercise", target: "" }], main: [] } },
    };
    settingsRepository.restorePoints = [
      {
        id: "rp1",
        createdAt: "2026-03-01T10:00:00.000Z",
        workoutData: null,
        templates: savedTemplates,
        plans: null,
      },
    ];

    const localTemplateRepo = new InMemoryTemplateRepository(null);
    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: localTemplateRepo,
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
    });

    const result = await service.rollbackToRestorePoint("rp1");

    expect(result.status).toBe("success");
    const restoredTemplates = await localTemplateRepo.readSnapshot();
    expect(restoredTemplates?.data.gym.warmup[0].text).toBe("Saved exercise");
  });

  it("pruneRestorePoints keeps only the newest when multiple exist", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    settingsRepository.restorePoints = [
      { id: "rp1", createdAt: "2026-03-01T08:00:00.000Z", workoutData: null, templates: null },
      { id: "rp3", createdAt: "2026-03-01T10:00:00.000Z", workoutData: null, templates: null },
      { id: "rp2", createdAt: "2026-03-01T09:00:00.000Z", workoutData: null, templates: null },
    ];

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
    });

    await service.pruneRestorePoints();

    expect(settingsRepository.restorePoints.length).toBe(1);
    expect(settingsRepository.restorePoints[0].id).toBe("rp3");
  });

  it("pruneRestorePoints is a no-op when only one restore point exists", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    settingsRepository.restorePoints = [
      { id: "rp1", createdAt: "2026-03-01T10:00:00.000Z", workoutData: null, templates: null },
    ];

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: new InMemoryWorkoutRepository(null),
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: null,
      cloudTemplateRepository: null,
    });

    await service.pruneRestorePoints();

    expect(settingsRepository.restorePoints.length).toBe(1);
    expect(settingsRepository.restorePoints[0].id).toBe("rp1");
  });

  it("rollback fully restores workout data to pre-sync state", async () => {
    const settingsRepository = new InMemorySyncSettingsRepository();
    const preSyncWorkout: WorkoutDataSnapshot = {
      version: 1,
      updatedAt: "2026-03-01T09:00:00.000Z",
      data: {
        "2026-03-01": { ...createEmptyDay("2026-03-01", "gym"), warmupNotes: "Pre-sync note" },
      },
    };
    const localWorkoutRepo = new InMemoryWorkoutRepository(preSyncWorkout);

    const service = new SyncService({
      settingsRepository,
      localWorkoutRepository: localWorkoutRepo,
      localTemplateRepository: new InMemoryTemplateRepository(null),
      cloudWorkoutRepository: new InMemoryWorkoutRepository(preSyncWorkout),
      cloudTemplateRepository: new InMemoryTemplateRepository(null),
    });

    await service.syncNow();
    const restorePointId = settingsRepository.restorePoints[0]?.id;

    await localWorkoutRepo.writeSnapshot({
      version: 1,
      updatedAt: "2026-03-01T11:00:00.000Z",
      data: {
        "2026-03-01": { ...createEmptyDay("2026-03-01", "gym"), warmupNotes: "Overwritten note" },
      },
    });

    const rollbackResult = await service.rollbackToRestorePoint(restorePointId);
    expect(rollbackResult.status).toBe("success");

    const restored = await localWorkoutRepo.readSnapshot();
    expect(restored?.data["2026-03-01"].warmupNotes).toBe("Pre-sync note");
    expect(restored?.updatedAt).toBe("2026-03-01T09:00:00.000Z");
  });
});
