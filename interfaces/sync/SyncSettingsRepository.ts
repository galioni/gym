export type SyncMode = "local" | "cloud";

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
  readRestorePoints(): Promise<
    Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
    }>
  >;
  writeRestorePoints(
    points: Array<{
      id: string;
      createdAt: string;
      workoutData: unknown;
      templates: unknown;
    }>
  ): Promise<void>;
}
