import { DayData } from "../../types";
import { WorkoutDataSnapshot } from "../../application/sync/syncTypes";

/**
 * Storage boundary for persisted workout-day snapshots keyed by ISO date.
 * Implementations may use localStorage, API, or any other persistence backend.
 */
export interface WorkoutDataRepository {
  readAll(): Promise<Record<string, DayData>>;
  writeAll(data: Record<string, DayData>): Promise<void>;
  readSnapshot(): Promise<WorkoutDataSnapshot | null>;
  writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void>;
  /**
   * Records that the user deleted this day so sync can propagate the deletion instead of restoring it.
   * Only meaningful for the local repository; cloud repositories receive deletions through writeSnapshot.
   */
  recordDeletion?(date: string, day: DayData): Promise<void>;
}
