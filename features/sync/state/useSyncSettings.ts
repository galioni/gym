import { useCallback, useEffect, useRef, useState } from "react";
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const loaded = await service.getSettings();
      if (!cancelled) {
        const loadedRestorePoints = await service.getRestorePoints();
        if (cancelled || !mountedRef.current) {
          return;
        }
        setSettings(loaded);
        setRestorePoints(loadedRestorePoints);
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
      if (!mountedRef.current) {
        return;
      }
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
      const loadedSettings = await service.getSettings();
      const loadedRestorePoints = await service.getRestorePoints();
      if (!mountedRef.current) {
        return result;
      }
      setSyncMessage(result.message);
      setConflicts(result.conflicts);
      setSettings(loadedSettings);
      setRestorePoints(loadedRestorePoints);
      setIsSyncing(false);
      return result;
    },
    [service]
  );
  const rollbackToRestorePoint = useCallback(
    async (id: string) => {
      const result = await service.rollbackToRestorePoint(id);
      const loadedSettings = await service.getSettings();
      const loadedRestorePoints = await service.getRestorePoints();
      if (!mountedRef.current) {
        return result;
      }
      setSyncMessage(result.message);
      setSettings(loadedSettings);
      setRestorePoints(loadedRestorePoints);
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
