import { STORAGE_KEY, STORAGE_SCHEMA_VERSION, TEMPLATES } from "../../constants";
import { DayData } from "../../types";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { WorkoutDataSnapshot } from "../../application/sync/syncTypes";
import { migrateRawWorkoutSnapshot } from "../../application/sync/migrations/snapshotMigrations";

export class LocalStorageWorkoutDataRepository implements WorkoutDataRepository {
  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const snapshot: WorkoutDataSnapshot = migrateRawWorkoutSnapshot(parsed);
      await this.writeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.error("Failed to parse workout storage, resetting to empty state.", error);
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void> {
    if (snapshot.version > STORAGE_SCHEMA_VERSION) {
      throw new Error(
        `Cannot write workout data schema version ${snapshot.version}: app supports up to v${STORAGE_SCHEMA_VERSION}.`
      );
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        data: sanitizeDayDataRecord(snapshot.data, TEMPLATES),
      })
    );
  }

  public async readAll(): Promise<Record<string, DayData>> {
    const snapshot = await this.readSnapshot();
    if (!snapshot) {
      return {};
    }
    return snapshot.data;
  }

  public async writeAll(data: Record<string, DayData>): Promise<void> {
    await this.writeSnapshot({
      version: STORAGE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      data: sanitizeDayDataRecord(data, TEMPLATES),
    });
  }
}
