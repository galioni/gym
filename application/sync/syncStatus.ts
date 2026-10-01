export type SyncStatusKind = "attention" | "offline" | "syncing" | "synced" | "idle";

export interface SyncStatus {
  kind: SyncStatusKind;
  /** Short label for the header. */
  label: string;
  /** One sentence for tooltips, screen readers and the Settings panel. */
  detail: string;
}

import { formatNextSync } from "./syncAllowance";

export interface SyncStatusInput {
  isSyncing: boolean;
  isOnline: boolean;
  conflictCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** Present for a Free account under the monthly allowance. */
  allowance?: { nextAvailableAt: string | null } | null;
  now?: number;
}

function ago(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * What the user should be told about sync, most important first. A problem outranks "syncing" so a failing
 * account does not flicker between states every time an automatic retry starts.
 */
export function deriveSyncStatus({
  isSyncing,
  isOnline,
  conflictCount,
  lastError,
  lastSyncedAt,
  allowance = null,
  now = Date.now(),
}: SyncStatusInput): SyncStatus {
  if (conflictCount > 0) {
    return {
      kind: "attention",
      label: "Needs attention",
      detail: `${conflictCount} ${conflictCount === 1 ? "conflict needs" : "conflicts need"} your decision. Nothing has been overwritten.`,
    };
  }
  if (!isOnline) {
    return {
      kind: "offline",
      label: "Offline",
      detail: "You're offline. Changes are saved on this device and will sync when you're back online.",
    };
  }
  if (lastError) {
    return { kind: "attention", label: "Sync problem", detail: lastError };
  }
  if (isSyncing) {
    return { kind: "syncing", label: "Syncing", detail: "Syncing your data…" };
  }
  const freePlan = allowance
    ? allowance.nextAvailableAt
      ? ` Free plan: the next sync is available on ${formatNextSync(allowance.nextAvailableAt)}.`
      : " Free plan: a sync is available now."
    : "";
  if (lastSyncedAt) {
    return {
      kind: "synced",
      label: "Synced",
      detail: `Everything is up to date. Last synced ${ago(lastSyncedAt, now)}.${freePlan}`,
    };
  }
  return {
    kind: "idle",
    label: "Not synced yet",
    detail: allowance ? `Sync from Settings when you want to back up.${freePlan}` : "Your data will sync automatically.",
  };
}
