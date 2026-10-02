import { useCallback, useEffect, useRef } from "react";
import { PLANS_STORAGE_KEY, STORAGE_KEY, TEMPLATE_STORAGE_KEY } from "../../../constants";
import { ConflictResolution, SyncConflict, SyncEntity, SyncNowResult } from "../../../application/sync/syncTypes";
import { SyncSignal } from "../../../interfaces/sync/SyncSignal";
import { checkSyncOwner } from "./syncOwner";

const DEBOUNCE_MS = 3000;
const FOCUS_MIN_INTERVAL_MS = 15_000;
const POLL_MS = 5 * 60_000;
/** Several statements in a row (a sync writes days, then templates, then plans) send several signals: act once. */
const SIGNAL_DEBOUNCE_MS = 1500;
/** A trigger that arrived during a sync is answered this long after it ends. */
const RERUN_DELAY_MS = 500;

interface UseAutoSyncOptions {
  /** Local data has finished loading into memory (never sync before this). */
  ready: boolean;
  userId: string | null;
  syncNow: (
    resolution?: Partial<Record<SyncEntity, ConflictResolution>>,
    options?: { automatic?: boolean; downloadOnly?: boolean }
  ) => Promise<SyncNowResult>;
  /** Automatic syncs only bring the cloud's data to this device and send nothing (the Free plan uploads by hand, once a month). */
  downloadOnly?: boolean;
  /** The server's "your data changed elsewhere" hint. Optional: without it the poll and the other triggers still run. */
  signal?: SyncSignal;
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
  downloadOnly = false,
  signal,
  changeSignal,
  onLocalDataChanged,
  onConflicts,
  onStorageLimit,
  onOwnerMismatch,
}: UseAutoSyncOptions): void {
  const runningRef = useRef(false);
  /** A trigger arrived while a sync was running: that sync may have read local data before the change, so run once more. */
  const rerunRef = useRef(false);
  const rerunTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
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
    if (!ready || !userId || ownerBlockedRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (runningRef.current) {
      // Dropping this trigger would leave the change unsynced until the next poll (up to 5 minutes): the running sync may
      // already have read local data. Remember it and run again when this one ends.
      rerunRef.current = true;
      return;
    }

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
      const result = await callbacks.current.syncNow({}, { automatic: true, downloadOnly });
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
      if (rerunRef.current && mountedRef.current) {
        rerunRef.current = false;
        window.clearTimeout(rerunTimerRef.current);
        rerunTimerRef.current = window.setTimeout(() => void runRef.current(), RERUN_DELAY_MS);
      }
    }
  }, [ready, userId, downloadOnly]);

  // The rerun above must call the latest run, and must not outlive the component.
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(rerunTimerRef.current);
    };
  }, []);

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

  // Another device changed the account: sync soon. Only where this device syncs on its own (a Free account does not, so it
  // does not listen either).
  useEffect(() => {
    if (!signal || !ready || !userId || downloadOnly) return;
    let timer: number | undefined;
    const stop = signal.subscribe(userId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), SIGNAL_DEBOUNCE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [signal, ready, userId, downloadOnly, run]);

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
