import React, { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { deriveSyncStatus } from "../../../../application/sync/syncStatus";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { SyncStatusIndicator } from "../SyncStatusIndicator/SyncStatusIndicator";
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
    return `Plan "${path}"`;
  }
  if (entity === "settings") {
    return path === "activePlanId" ? "Active plan" : "Plan details";
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
  onSyncNow: (
    resolution?: Partial<Record<SyncEntity, ConflictResolution>>
  ) => Promise<SyncNowResult>;
  onRollback: (id: string) => Promise<SyncNowResult>;
  onPruneRestorePoints: () => Promise<void>;
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
  onPruneRestorePoints,
}) => {
  const { showToast } = useFeedback();
  const { session } = useAuthSession();
  const isAuthenticated = Boolean(session);
  const [resolutions, setResolutions] = useState<Partial<Record<SyncEntity, ConflictResolution>>>({});

  const isOnline = useOnlineStatus();
  const status = deriveSyncStatus({ isSyncing, isOnline, conflictCount: conflicts.length, lastError, lastSyncedAt });
  // The red banner below carries the error text; the headline only summarises it.
  const headlineDetail = lastError && status.detail === lastError ? "Sync hit a problem. Your data is safe on this device." : status.detail;
  const hasConflicts = conflicts.length > 0;
  const showMessage = Boolean(syncMessage) && syncMessage !== lastError && !hasConflicts && syncMessage !== "Sync completed.";
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
          {isSyncing ? "Syncing..." : "Sync now"}
        </Button>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-background/40 p-3">
        <SyncStatusIndicator status={status} onClick={() => undefined} className="-m-1 shrink-0 pointer-events-none" />
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-semibold text-label">Your data syncs automatically</div>
          <div className="text-xs text-labelSecondary">{headlineDetail}</div>
          <div className="text-xs text-labelTertiary break-words">
            {isAuthenticated ? `Signed in as ${session?.user.email ?? "Google"}` : "Not signed in — sync disabled"}
            {lastSyncedAt ? ` · last sync ${new Date(lastSyncedAt).toLocaleString()}` : ""}
          </div>
        </div>
      </div>

      {/* The headline already says "synced" / "needs your decision" / the error; only show other messages
          (for example a rollback result) so nothing is said twice. */}
      {showMessage && (
        <div className="mb-3 rounded-xl border border-border bg-background/40 p-3 text-xs text-labelSecondary">
          {syncMessage}
        </div>
      )}
      {lastError && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-dangerText">
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
                    <div className="text-sm font-semibold text-label">{entityLabel} conflict</div>
                    <div className="text-xs text-labelSecondary mt-0.5">
                      This device {relativeTime(conflict.localUpdatedAt)}
                      {" · "}
                      Cloud {relativeTime(conflict.cloudUpdatedAt)}
                      {localNewer
                        ? <span className="text-primary"> · This device is newer</span>
                        : <span className="text-labelSecondary"> · Cloud is newer</span>}
                    </div>
                  </div>
                </div>

                {conflict.previewPaths.length > 0 && (
                  <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-labelTertiary mb-1.5">
                      What differs
                    </div>
                    <ul className="space-y-0.5">
                      {conflict.previewPaths.map((path) => (
                        <li key={`${conflict.entity}-${path}`} className="text-xs text-labelSecondary">
                          {formatConflictPath(conflict.entity, path)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2" role="group" aria-label={`${entityLabel} conflict: choose a version`}>
                  <Button
                    size="sm"
                    aria-pressed={chosen === "keepLocal"}
                    variant={chosen === "keepLocal" ? "primary" : "secondary"}
                    onClick={() =>
                      setResolutions((current) => ({ ...current, [conflict.entity]: "keepLocal" }))
                    }
                  >
                    Keep this device
                  </Button>
                  <Button
                    size="sm"
                    aria-pressed={chosen === "keepCloud"}
                    variant={chosen === "keepCloud" ? "primary" : "secondary"}
                    onClick={() =>
                      setResolutions((current) => ({ ...current, [conflict.entity]: "keepCloud" }))
                    }
                  >
                    Keep cloud
                  </Button>
                </div>

                {chosen && (
                  <p className="text-[11px] text-labelTertiary">
                    {chosen === "keepLocal"
                      ? "This device's version wins for overlapping changes. Any cloud-only changes are preserved."
                      : "Cloud version wins for overlapping changes. Any local-only changes are preserved."}
                  </p>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              size="sm"
              variant="primary"
              className="gap-2"
              onClick={() => void handleSyncNow()}
              disabled={isSyncing || !canResolve}
            >
              <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
              Apply choices and sync
            </Button>
            {!canResolve && <p className="text-xs text-labelSecondary">Choose a version for each conflict above.</p>}
          </div>
        </div>
      )}

      {restorePoints.length > 0 && (
        <div className="mt-4 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-label font-semibold">Safety snapshots</div>
              <div className="text-xs text-labelTertiary mt-0.5">Saved automatically before a sync that changes your data. Roll back if a sync overwrote something you wanted to keep.</div>
            </div>
            {restorePoints.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-labelSecondary hover:text-dangerText"
                onClick={() => void onPruneRestorePoints()}
              >
                Keep newest only
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {restorePoints.map((point) => (
              <div key={point.id} className="flex flex-col items-start gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-labelSecondary">
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
