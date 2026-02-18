import { useCallback, useEffect, useState } from "react";
import { SyncService } from "../../../application/sync/SyncService";
import {
  ConflictResolution,
  SyncConflict,
  SyncNowResult,
  SyncRestorePoint,
} from "../../../application/sync/syncTypes";
import {
  SyncMode,
  SyncSettings,
} from "../../../interfaces/sync/SyncSettingsRepository";

interface UseSyncSettingsResult {
  settings: SyncSettings;
  isSyncing: boolean;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  syncMessage: string;
  setMode: (mode: SyncMode) => Promise<void>;
  syncNow: (
    resolution?: Partial<Record<"workoutData" | "templates", ConflictResolution>>
  ) => Promise<SyncNowResult>;
  rollbackToRestorePoint: (id: string) => Promise<SyncNowResult>;
}

export function useSyncSettings(service: SyncService): UseSyncSettingsResult {
  const [settings, setSettings] = useState<SyncSettings>({
    mode: "local",
    lastSyncedAt: null,
    lastError: null,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [restorePoints, setRestorePoints] = useState<SyncRestorePoint[]>([]);
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const loaded = await service.getSettings();
      if (!cancelled) {
        setSettings(loaded);
        setRestorePoints(await service.getRestorePoints());
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [service]);

  const setMode = useCallback(
    async (mode: SyncMode) => {
      const next = await service.setMode(mode);
      setSettings(next);
      setConflicts([]);
      setSyncMessage("");
    },
    [service]
  );

  const syncNow = useCallback(
    async (
      resolution: Partial<
        Record<"workoutData" | "templates", ConflictResolution>
      > = {}
    ) => {
      setIsSyncing(true);
      const result = await service.syncNow(resolution);
      setSyncMessage(result.message);
      setConflicts(result.conflicts);
      setSettings(await service.getSettings());
      setRestorePoints(await service.getRestorePoints());
      setIsSyncing(false);
      return result;
    },
    [service]
  );
  const rollbackToRestorePoint = useCallback(
    async (id: string) => {
      const result = await service.rollbackToRestorePoint(id);
      setSyncMessage(result.message);
      setSettings(await service.getSettings());
      setRestorePoints(await service.getRestorePoints());
      return result;
    },
    [service]
  );

  return {
    settings,
    isSyncing,
    conflicts,
    restorePoints,
    syncMessage,
    setMode,
    syncNow,
    rollbackToRestorePoint,
  };
}
