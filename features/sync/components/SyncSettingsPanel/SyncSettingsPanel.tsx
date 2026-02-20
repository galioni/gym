import React, { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import {
  SyncConflict,
  SyncNowResult,
  SyncRestorePoint,
} from "../../../../application/sync/syncTypes";
import { useFeedback } from "../../../feedback/hooks/useFeedback";

interface SyncSettingsPanelProps {
  lastSyncedAt: string | null;
  lastError: string | null;
  syncMessage: string;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  isSyncing: boolean;
  onSyncNow: (
    resolution?: Partial<Record<"workoutData" | "templates", "keepLocal" | "keepCloud">>
  ) => Promise<SyncNowResult>;
  onRollback: (id: string) => Promise<SyncNowResult>;
}

export const SyncSettingsPanel: React.FC<SyncSettingsPanelProps> = ({
  lastSyncedAt,
  lastError,
  syncMessage,
  conflicts,
  restorePoints,
  isSyncing,
  onSyncNow,
  onRollback,
}) => {
  const { showToast } = useFeedback();
  const [resolutions, setResolutions] = useState<
    Partial<Record<"workoutData" | "templates", "keepLocal" | "keepCloud">>
  >({});

  const hasConflicts = conflicts.length > 0;
  const canResolve = useMemo(
    () => conflicts.every((conflict) => Boolean(resolutions[conflict.entity])),
    [conflicts, resolutions]
  );

  const toastSyncResult = (result: SyncNowResult) => {
    if (result.status === "success") {
      showToast({ tone: "success", title: result.message || "Sync completed" });
      return;
    }
    if (result.status === "conflict") {
      showToast({
        tone: "info",
        title: "Conflict resolution required",
        description: result.message,
      });
      return;
    }
    if (result.status === "error") {
      showToast({ tone: "error", title: "Sync failed", description: result.message });
    }
  };

  const handleSyncNow = async () => {
    try {
      const result = await onSyncNow(hasConflicts ? resolutions : undefined);
      toastSyncResult(result);
    } catch (error) {
      const description = error instanceof Error ? error.message : "Unexpected sync failure.";
      showToast({ tone: "error", title: "Sync failed", description });
    }
  };

  const handleRollback = async (id: string) => {
    try {
      const result = await onRollback(id);
      if (result.status === "success") {
        showToast({ tone: "success", title: "Rollback complete" });
        return;
      }
      showToast({ tone: "error", title: "Rollback failed", description: result.message });
    } catch (error) {
      const description = error instanceof Error ? error.message : "Unexpected rollback failure.";
      showToast({ tone: "error", title: "Rollback failed", description });
    }
  };

  return (
    <Card
      className="motion-rise"
      title="Sync Settings"
      headerAction={
        <Button
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto min-h-11 gap-2 justify-center"
          onClick={() => void handleSyncNow()}
          disabled={isSyncing || (hasConflicts && !canResolve)}
        >
          <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? "Syncing..." : "Sync Now"}
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 flex items-center">
          Sync Mode: CLOUD
        </div>
        <div className="text-xs text-slate-400 flex items-center break-words">
          Last sync: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Never"}
        </div>
        <div className="text-xs text-slate-400 flex items-center break-words">Auth: Google OAuth</div>
      </div>

      {syncMessage && (
        <div className="mb-3 rounded-xl border border-white/10 bg-background/40 p-3 text-xs text-slate-300">
          {syncMessage}
        </div>
      )}
      {lastError && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-red-200">
          {lastError}
        </div>
      )}

      {hasConflicts && (
        <div className="space-y-3">
          {conflicts.map((conflict) => (
            <div key={conflict.entity} className="rounded-xl border border-white/10 p-3">
              <div className="text-sm text-white font-semibold capitalize">
                {conflict.entity === "workoutData" ? "Workout Data Conflict" : "Template Conflict"}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Local: {new Date(conflict.localUpdatedAt).toLocaleString()} | Cloud:{" "}
                {new Date(conflict.cloudUpdatedAt).toLocaleString()}
              </div>
              {conflict.previewPaths.length > 0 && (
                <div className="mt-2 rounded-lg border border-white/10 bg-background/40 p-2">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400 mb-1">
                    Changed Paths
                  </div>
                  <ul className="text-xs text-slate-300 space-y-1">
                    {conflict.previewPaths.map((path) => (
                      <li key={`${conflict.entity}-${path}`} className="font-mono break-all">
                        {path}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={resolutions[conflict.entity] === "keepLocal" ? "primary" : "ghost"}
                  onClick={() =>
                    setResolutions((current) => ({ ...current, [conflict.entity]: "keepLocal" }))
                  }
                >
                  Keep Local
                </Button>
                <Button
                  size="sm"
                  variant={resolutions[conflict.entity] === "keepCloud" ? "primary" : "ghost"}
                  onClick={() =>
                    setResolutions((current) => ({ ...current, [conflict.entity]: "keepCloud" }))
                  }
                >
                  Keep Cloud
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {restorePoints.length > 0 && (
        <div className="mt-4 rounded-xl border border-white/10 p-3">
          <div className="text-sm text-white font-semibold mb-2">Pre-sync Restore Points</div>
          <div className="space-y-2">
            {restorePoints.map((point) => (
              <div key={point.id} className="flex flex-col items-start gap-2 rounded-lg border border-white/10 p-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-300">
                  {new Date(point.createdAt).toLocaleString()}
                </div>
                <Button size="sm" variant="ghost" onClick={() => void handleRollback(point.id)}>
                  Rollback
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
