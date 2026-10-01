import { useCallback, useEffect, useRef } from "react";
import { PLANS_STORAGE_KEY, STORAGE_KEY, TEMPLATE_STORAGE_KEY } from "../../../constants";
import { ConflictResolution, SyncConflict, SyncEntity, SyncNowResult } from "../../../application/sync/syncTypes";
import { checkSyncOwner } from "./syncOwner";

const DEBOUNCE_MS = 3000;
const FOCUS_MIN_INTERVAL_MS = 15_000;
const POLL_MS = 5 * 60_000;

interface UseAutoSyncOptions {
  /** Local data has finished loading into memory (never sync before this). */
  ready: boolean;
  userId: string | null;
  syncNow: (
    resolution?: Partial<Record<SyncEntity, ConflictResolution>>,
    options?: { automatic?: boolean }
  ) => Promise<SyncNowResult>;
  /** Changes identity whenever local data changes; schedules a debounced sync. */
  changeSignal: unknown;
  /** A sync (or another tab) changed local storage: reload in-memory state from it. */
  onLocalDataChanged: () => void;
  /** A sync needs the user to choose between local and cloud. */
  onConflicts: (conflicts: SyncConflict[]) => void;
  /** The account hit a database storage limit; local data is intact but new data cannot sync. */
  onStorageLimit: (message: string) => void;
  /** This browser holds another account's data; sync is paused until the user decides. */
  onOwnerMismatch: () => void;
}

/**
 * Keeps local storage and the cloud in step without the user pressing anything: after sign-in, shortly
 * after local edits, when the connection returns, when the tab regains focus, and every few minutes.
 * Failures are silent here (they are recorded in the sync settings and retried by the next trigger).
 */
export function useAutoSync({
  ready,
  userId,
  syncNow,
  changeSignal,
  onLocalDataChanged,
  onConflicts,
  onStorageLimit,
  onOwnerMismatch,
}: UseAutoSyncOptions): void {
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);
  const ownerCheckedFor = useRef<string | null>(null);
  const ownerBlockedRef = useRef(false);
  const conflictSignatureRef = useRef("");
  const limitNotifiedRef = useRef(false);

  // Latest callbacks without re-subscribing every listener on each render.
  const callbacks = useRef({ syncNow, onLocalDataChanged, onConflicts, onStorageLimit, onOwnerMismatch });
  useEffect(() => {
    callbacks.current = { syncNow, onLocalDataChanged, onConflicts, onStorageLimit, onOwnerMismatch };
  });

  const run = useCallback(async () => {
    if (!ready || !userId || runningRef.current || ownerBlockedRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    if (ownerCheckedFor.current !== userId) {
      ownerCheckedFor.current = userId;
      if (checkSyncOwner(userId) === "mismatch") {
        ownerBlockedRef.current = true;
        callbacks.current.onOwnerMismatch();
        return;
      }
    }

    runningRef.current = true;
    lastRunRef.current = Date.now();
    try {
      const result = await callbacks.current.syncNow({}, { automatic: true });
      if (result.appliedToLocal) {
        callbacks.current.onLocalDataChanged();
      }
      if (result.status === "conflict") {
        // Tell the user once per distinct set of conflicts, not on every retry.
        const signature = result.conflicts.map((c) => `${c.entity}:${c.previewPaths.join("|")}`).join(";");
        if (signature !== conflictSignatureRef.current) {
          conflictSignatureRef.current = signature;
          callbacks.current.onConflicts(result.conflicts);
        }
      } else {
        conflictSignatureRef.current = "";
      }
      // Tell the user once; stay quiet on retries until a sync gets through again.
      if (result.reason === "storageLimit") {
        if (!limitNotifiedRef.current) {
          limitNotifiedRef.current = true;
          callbacks.current.onStorageLimit(result.message);
        }
      } else if (result.status === "success") {
        limitNotifiedRef.current = false;
      }
    } catch (error) {
      // Triggers fire this without awaiting it; a failure must not escape as an unhandled rejection or
      // wedge the hook. The next trigger simply tries again.
      console.error("[auto-sync] sync failed", error);
    } finally {
      runningRef.current = false;
    }
  }, [ready, userId]);

  // After sign-in / once local data is loaded.
  useEffect(() => {
    void run();
  }, [run]);

  // Shortly after local edits.
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    const timer = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [changeSignal, run]);

  // Connection back, tab focused again, and a slow poll for changes made on other devices.
  useEffect(() => {
    const onOnline = () => void run();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunRef.current > FOCUS_MIN_INTERVAL_MS) {
        void run();
      }
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, POLL_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run]);
}

/**
 * Another tab changed this browser's data: reload in-memory state so the next save here cannot overwrite
 * those changes with a stale copy. Independent of sync, so it applies to every backend.
 */
export function useCrossTabReload(onLocalDataChanged: () => void): void {
  const handler = useRef(onLocalDataChanged);
  useEffect(() => {
    handler.current = onLocalDataChanged;
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === TEMPLATE_STORAGE_KEY || event.key === PLANS_STORAGE_KEY) {
        handler.current();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
