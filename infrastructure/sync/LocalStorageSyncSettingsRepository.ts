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
/** Roughly 2 MB of the ~5 MB a browser grants an origin. */
export const RESTORE_POINTS_BUDGET_CHARS = 2_000_000;

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
    // Every restore point holds full copies of the data, and the browser keeps only a few MB for the whole app. So the
    // newest points are kept within a budget and older ones are dropped first; the newest is always kept, because a sync
    // that is about to change data needs the point it just took.
    let kept = points;
    let serialized = JSON.stringify(kept);
    while (kept.length > 1 && serialized.length > RESTORE_POINTS_BUDGET_CHARS) {
      kept = kept.slice(0, -1);
      serialized = JSON.stringify(kept);
    }
    for (;;) {
      try {
        localStorage.setItem(SYNC_RESTORE_POINTS_STORAGE_KEY, serialized);
        return;
      } catch (error) {
        // Storage is fuller than the budget assumed (other app data lives there too): drop the oldest and retry. If even the
        // newest point alone does not fit, fail the sync step rather than carry on without a way back.
        if (kept.length <= 1) throw error;
        kept = kept.slice(0, -1);
        serialized = JSON.stringify(kept);
      }
    }
  }
}
