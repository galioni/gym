import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";
import { DayData } from "../../types";
import { WorkoutDataSnapshot } from "./syncTypes";

/**
 * The Free plan keeps the last 7 days of workout history in the cloud (today and the six days before). Older days stay on
 * the device, untouched. See supabase/migrations/*_free_history_window.sql for the matching rule in the database.
 */
export const FREE_HISTORY_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, "0");

/** The oldest day (YYYY-MM-DD, in the reader's own calendar) that still counts, for a window of `days` days. */
export function historyCutoff(days: number, now: Date = new Date()): string {
  const oldest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return `${oldest.getFullYear()}-${pad(oldest.getMonth() + 1)}-${pad(oldest.getDate())}`;
}

function keepRecent<T>(record: Record<string, T> | undefined, cutoff: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record ?? {}).filter(([date]) => date >= cutoff));
}

/**
 * The cloud as the Free plan uses it: reading is untouched, but nothing older than the window is ever sent, whether as a day
 * or as a deletion. It only narrows what this device uploads; it never removes anything, on the device or in the cloud.
 */
export class HistoryLimitedCloudWorkout implements WorkoutDataRepository {
  public constructor(
    private readonly inner: WorkoutDataRepository,
    private readonly cutoff: string
  ) {}

  public readAll(): Promise<Record<string, DayData>> {
    return this.inner.readAll();
  }

  public readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    return this.inner.readSnapshot();
  }

  public async writeAll(data: Record<string, DayData>): Promise<void> {
    await this.inner.writeAll(keepRecent(data, this.cutoff));
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void> {
    await this.inner.writeSnapshot({
      ...snapshot,
      data: keepRecent(snapshot.data, this.cutoff),
      ...(snapshot.deletedDays ? { deletedDays: keepRecent(snapshot.deletedDays, this.cutoff) } : {}),
    });
  }
}
