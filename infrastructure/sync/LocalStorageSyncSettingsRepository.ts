import {
  SyncSettings,
  SyncSettingsRepository,
} from "../../interfaces/sync/SyncSettingsRepository";

const SYNC_SETTINGS_KEY = "daily-workout-tracker:sync-settings:v1";
const SYNC_RESTORE_POINTS_KEY = "daily-workout-tracker:sync-restore-points:v1";

/**
 * Local persistence for sync mode/status metadata.
 */
export class LocalStorageSyncSettingsRepository
  implements SyncSettingsRepository
{
  public async readSettings(): Promise<SyncSettings> {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (!raw) {
      return { mode: "local", lastSyncedAt: null, lastError: null };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SyncSettings>;
      return {
        mode: parsed.mode === "cloud" ? "cloud" : "local",
        lastSyncedAt:
          typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
        lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      };
    } catch {
      return { mode: "local", lastSyncedAt: null, lastError: null };
    }
  }

  public async writeSettings(settings: SyncSettings): Promise<void> {
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
  }

  public async readRestorePoints(): Promise<
    Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
    }>
  > {
    const raw = localStorage.getItem(SYNC_RESTORE_POINTS_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as Array<{
        id: string;
        createdAt: string;
        workoutData: unknown;
        templates: unknown;
      }>;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async writeRestorePoints(
    points: Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
    }>
  ): Promise<void> {
    localStorage.setItem(SYNC_RESTORE_POINTS_KEY, JSON.stringify(points));
  }
}
