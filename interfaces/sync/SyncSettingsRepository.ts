import type { SyncBase } from "../../application/sync/syncMerge";

export type SyncMode = "cloud";

export interface SyncSettings {
  mode: SyncMode;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/**
 * Persistence boundary for sync settings and status metadata.
 */
export interface SyncSettingsRepository {
  readSettings(): Promise<SyncSettings>;
  writeSettings(settings: SyncSettings): Promise<void>;
  /** What both sides last agreed on (content hashes), enabling three-way merges. Absent = no base. */
  readSyncBase?(): Promise<SyncBase>;
  writeSyncBase?(base: SyncBase): Promise<void>;
  readRestorePoints(): Promise<
    Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
      plans?: unknown;
    }>
  >;
  writeRestorePoints(
    points: Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
      plans?: unknown;
    }>
  ): Promise<void>;
}
