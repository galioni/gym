import { STORAGE_KEY, STORAGE_SCHEMA_VERSION, TEMPLATES } from "../../constants";
import { DayData } from "../../types";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { WorkoutDataSnapshot } from "../../application/sync/syncTypes";

interface WorkoutStorageEnvelope {
  version: number;
  updatedAt: string;
  data: Record<string, DayData>;
}

/**
 * Local storage adapter for workout tracking snapshots.
 * Throws when parse/write fails so the application layer can handle UI state.
 */
export class LocalStorageWorkoutDataRepository implements WorkoutDataRepository {
  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as WorkoutStorageEnvelope | Record<string, unknown>;
      const isEnvelope = Boolean(
        parsed &&
          typeof parsed === "object" &&
          "version" in parsed &&
          "data" in parsed
      );
      const payload = isEnvelope ? (parsed as WorkoutStorageEnvelope).data : (parsed as Record<string, unknown>);
      const sanitized = sanitizeDayDataRecord(payload, TEMPLATES);
      const snapshot: WorkoutDataSnapshot = {
        version: STORAGE_SCHEMA_VERSION,
        updatedAt:
          isEnvelope && typeof (parsed as WorkoutStorageEnvelope).updatedAt === "string"
            ? (parsed as WorkoutStorageEnvelope).updatedAt
            : new Date().toISOString(),
        data: sanitized,
      };
      await this.writeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.error("Failed to parse workout storage, resetting to empty state.", error);
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void> {
    const envelope: WorkoutStorageEnvelope = {
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      data: sanitizeDayDataRecord(snapshot.data, TEMPLATES),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
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
