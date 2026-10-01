import {
  SyncSettings,
  SyncSettingsRepository,
} from "../../interfaces/sync/SyncSettingsRepository";
import {
  SYNC_BASE_STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
} from "../../constants";
import { EMPTY_SYNC_BASE, SyncBase } from "../../application/sync/syncMerge";

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

  public async readSyncBase(): Promise<SyncBase> {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_BASE_STORAGE_KEY) ?? "null") as Partial<SyncBase> | null;
      if (!parsed || typeof parsed !== "object") return EMPTY_SYNC_BASE;
      const days =
        parsed.days && typeof parsed.days === "object" && !Array.isArray(parsed.days)
          ? Object.fromEntries(Object.entries(parsed.days).filter(([, hash]) => typeof hash === "string"))
          : {};
      const items = (value: unknown): Record<string, string> =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).filter(([, hash]) => typeof hash === "string") as Array<[string, string]>)
          : {}; // the earlier whole-entity format (a single hash) is ignored: those items simply have no base yet
      return { days, templates: items(parsed.templates), plans: items(parsed.plans), settings: items(parsed.settings) };
    } catch {
      return EMPTY_SYNC_BASE;
    }
  }

  public async writeSyncBase(base: SyncBase): Promise<void> {
    localStorage.setItem(SYNC_BASE_STORAGE_KEY, JSON.stringify(base));
  }

  public async readRestorePoints(): Promise<
    Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
      plans?: unknown;
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
        plans?: unknown;
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
      plans?: unknown;
    }>
  ): Promise<void> {
    localStorage.setItem(SYNC_RESTORE_POINTS_STORAGE_KEY, JSON.stringify(points));
  }
}
