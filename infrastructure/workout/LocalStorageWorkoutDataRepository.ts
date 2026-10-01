import { DELETED_DAYS_STORAGE_KEY, STORAGE_KEY, STORAGE_SCHEMA_VERSION, TEMPLATES } from "../../constants";
import { DayData } from "../../types";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { sanitizeDayData, sanitizeDayDataRecord } from "../../application/workout/data/dayDataRules";
import { dayContentHash } from "../../application/sync/contentHash";
import { Tombstones } from "../../application/sync/deletionReconciliation";
import { WorkoutDataSnapshot } from "../../application/sync/syncTypes";
import { migrateRawWorkoutSnapshot } from "../../application/sync/migrations/snapshotMigrations";

function readTombstones(): Tombstones {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_DAYS_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, hash]) => typeof hash === "string")
    ) as Tombstones;
  } catch {
    return {};
  }
}

function writeTombstones(tombstones: Tombstones): void {
  if (Object.keys(tombstones).length === 0) {
    localStorage.removeItem(DELETED_DAYS_STORAGE_KEY);
  } else {
    localStorage.setItem(DELETED_DAYS_STORAGE_KEY, JSON.stringify(tombstones));
  }
}

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
      return { ...snapshot, deletedDays: readTombstones() };
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
    const data = sanitizeDayDataRecord(snapshot.data, TEMPLATES);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        data,
      })
    );

    // A day that is present again is no longer deleted; sync may also pass the exact set of tombstones to keep.
    const tombstones = readTombstones();
    for (const date of Object.keys(data)) delete tombstones[date];
    if (snapshot.deletedDays) {
      for (const date of Object.keys(tombstones)) {
        if (!(date in snapshot.deletedDays)) delete tombstones[date];
      }
    }
    writeTombstones(tombstones);
  }

  public async recordDeletion(date: string, day: DayData): Promise<void> {
    const tombstones = readTombstones();
    tombstones[date] = dayContentHash(sanitizeDayData(day, date, TEMPLATES));
    writeTombstones(tombstones);
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
