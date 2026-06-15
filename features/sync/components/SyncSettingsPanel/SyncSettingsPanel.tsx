import React, { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import {
  ConflictResolution,
  SyncConflict,
  SyncEntity,
  SyncNowResult,
  SyncRestorePoint,
} from "../../../../application/sync/syncTypes";
import { useFeedback } from "../../../feedback/hooks/useFeedback";
import { useAuthSession } from "../../../auth/hooks/useAuthSession";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatConflictPath(entity: SyncEntity, path: string): string {
  const parts = path.split(".");
  if (entity === "workoutData") {
    const [dateKey, field, idx, sub] = parts;
    if (!dateKey) return path;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    const dateStr = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
          "en-GB",
          { day: "numeric", month: "short" }
        )
      : dateKey;
    const simple: Record<string, string> = {
      weight: "body weight",
      warmupNotes: "warm-up notes",
      mainNotes: "main notes",
      checkNotes: "check-in notes",
      sessionType: "session type",
    };
    if (!field) return dateStr;
    if (simple[field]) return `${dateStr} — ${simple[field]}`;
    if (field === "warmup" || field === "main") {
      const sec = field === "warmup" ? "warm-up" : "main";
      const n = idx !== undefined ? ` #${Number(idx) + 1}` : "";
      if (sub === "done") return `${dateStr} — ${sec}${n} (checked)`;
      if (sub === "text") return `${dateStr} — ${sec}${n} name`;
      if (sub === "target") return `${dateStr} — ${sec}${n} target`;
      return `${dateStr} — ${sec}${n}`;
    }
    return `${dateStr} — ${field}`;
  }
  if (entity === "templates") {
    const [sessionKey, section, idx, sub] = parts;
    if (!sessionKey) return path;
    const session = sessionKey.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    if (!section) return session;
    const sec = section === "warmup" ? "warm-up" : section;
    const n = idx !== undefined ? ` #${Number(idx) + 1}` : "";
    if (sub === "text") return `${session} — ${sec}${n} name`;
    if (sub === "target") return `${session} — ${sec}${n} target`;
    return `${session} — ${sec}${n}`;
  }
  if (entity === "plans") {
    const [idx, field] = parts;
    const n = idx !== undefined ? ` #${Number(idx) + 1}` : "";
    return field ? `Plan${n} ${field}` : `Plan${n}`;
  }
  return path;
}

interface SyncSettingsPanelProps {
  lastSyncedAt: string | null;
  lastError: string | null;
  syncMessage: string;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  isSyncing: boolean;
  isUpgradeRequired: boolean;
  onSyncNow: (
    resolution?: Partial<Record<SyncEntity, ConflictResolution>>
  ) => Promise<SyncNowResult>;
  onRollback: (id: string) => Promise<SyncNowResult>;
  onPruneRestorePoints: () => Promise<void>;
  onUpgrade: () => Promise<void>;
}

export const SyncSettingsPanel: React.FC<SyncSettingsPanelProps> = ({
  lastSyncedAt,
  lastError,
  syncMessage,
  conflicts,
  restorePoints,
  isSyncing,
  isUpgradeRequired,
  onSyncNow,
  onRollback,
  onPruneRestorePoints,
  onUpgrade,
}) => {
  const { showToast } = useFeedback();
  const { session } = useAuthSession();
  const isAuthenticated = Boolean(session);
  const [resolutions, setResolutions] = useState<Partial<Record<SyncEntity, ConflictResolution>>>({});

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
          disabled={isSyncing || !isAuthenticated || (hasConflicts && !canResolve)}
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
        <div className="text-xs flex items-center break-words">
          {isAuthenticated ? (
            <span className="text-slate-400">Auth: {session?.user.email ?? "Google OAuth"}</span>
          ) : (
            <span className="text-amber-400">Not signed in — sync disabled</span>
          )}
        </div>
      </div>

      {isUpgradeRequired && (
        <div className="mb-3 rounded-xl border border-primary/30 bg-primary/10 p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-orange-100">Cloud sync requires a Pro subscription.</p>
          <Button size="sm" variant="primary" className="shrink-0" onClick={() => void onUpgrade().catch(() => showToast({ tone: "error", title: "Could not start checkout. Try again." }))}>
            Upgrade
          </Button>
        </div>
      )}
      {!isUpgradeRequired && syncMessage && (
        <div className="mb-3 rounded-xl border border-white/10 bg-background/40 p-3 text-xs text-slate-300">
          {syncMessage}
        </div>
      )}
      {!isUpgradeRequired && lastError && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-red-200">
          {lastError}
        </div>
      )}

      {hasConflicts && (
        <div className="space-y-3">
          {conflicts.map((conflict) => {
            const entityLabel =
              conflict.entity === "workoutData"
                ? "Workout data"
                : conflict.entity === "templates"
                  ? "Templates"
                  : "Plans";
            const localNewer = conflict.localUpdatedAt >= conflict.cloudUpdatedAt;
            const chosen = resolutions[conflict.entity];
            return (
              <div key={conflict.entity} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">{entityLabel} conflict</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      This device {relativeTime(conflict.localUpdatedAt)}
                      {" · "}
                      Cloud {relativeTime(conflict.cloudUpdatedAt)}
                      {localNewer
                        ? <span className="text-primary"> · This device is newer</span>
                        : <span className="text-slate-400"> · Cloud is newer</span>}
                    </div>
                  </div>
                </div>

                {conflict.previewPaths.length > 0 && (
                  <div className="rounded-lg border border-white/10 bg-background/40 px-2.5 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 mb-1.5">
                      What differs
                    </div>
                    <ul className="space-y-0.5">
                      {conflict.previewPaths.map((path) => (
                        <li key={`${conflict.entity}-${path}`} className="text-xs text-slate-300">
                          {formatConflictPath(conflict.entity, path)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={chosen === "keepLocal" ? "primary" : "ghost"}
                    onClick={() =>
                      setResolutions((current) => ({ ...current, [conflict.entity]: "keepLocal" }))
                    }
                  >
                    Keep this device
                  </Button>
                  <Button
                    size="sm"
                    variant={chosen === "keepCloud" ? "primary" : "ghost"}
                    onClick={() =>
                      setResolutions((current) => ({ ...current, [conflict.entity]: "keepCloud" }))
                    }
                  >
                    Keep cloud
                  </Button>
                </div>

                {chosen && (
                  <p className="text-[11px] text-slate-500">
                    {chosen === "keepLocal"
                      ? "This device's version wins for overlapping changes. Any cloud-only changes are preserved."
                      : "Cloud version wins for overlapping changes. Any local-only changes are preserved."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {restorePoints.length > 0 && (
        <div className="mt-4 rounded-xl border border-white/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-white font-semibold">Pre-sync Restore Points</div>
              <div className="text-xs text-slate-500 mt-0.5">Snapshots saved automatically before each sync. Roll back if a sync overwrote something you wanted to keep.</div>
            </div>
            {restorePoints.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-slate-400 hover:text-red-400"
                onClick={() => void onPruneRestorePoints()}
              >
                Keep newest only
              </Button>
            )}
          </div>
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
