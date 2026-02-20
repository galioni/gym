import {
  SyncSettings,
  SyncSettingsRepository,
} from "../../interfaces/sync/SyncSettingsRepository";
import {
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
} from "../../constants";

/**
 * Local persistence for sync mode/status metadata.
 */
export class LocalStorageSyncSettingsRepository
  implements SyncSettingsRepository
{
  public async readSettings(): Promise<SyncSettings> {
    const raw = localStorage.getItem(SYNC_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { mode: "cloud", lastSyncedAt: null, lastError: null };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SyncSettings>;
      return {
        mode: "cloud",
        lastSyncedAt:
          typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
        lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      };
    } catch {
      return { mode: "cloud", lastSyncedAt: null, lastError: null };
    }
  }

  public async writeSettings(settings: SyncSettings): Promise<void> {
    localStorage.setItem(SYNC_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }

  public async readRestorePoints(): Promise<
    Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
    }>
  > {
    const raw = localStorage.getItem(SYNC_RESTORE_POINTS_STORAGE_KEY);
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
    localStorage.setItem(SYNC_RESTORE_POINTS_STORAGE_KEY, JSON.stringify(points));
  }
}
