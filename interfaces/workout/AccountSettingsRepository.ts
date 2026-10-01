import { SettingsSnapshot } from "../../application/sync/syncTypes";

/**
 * Storage boundary for the preferences that follow the account across devices (active plan, plan params
 * and meta). Local storage and the database each implement it; SyncService reconciles the two.
 */
export interface AccountSettingsRepository {
  readSnapshot(): Promise<SettingsSnapshot | null>;
  writeSnapshot(snapshot: SettingsSnapshot): Promise<void>;
}
