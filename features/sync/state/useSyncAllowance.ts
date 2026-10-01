import { useCallback, useEffect, useRef, useState } from "react";
import { SyncAllowance, SyncAllowanceStatus } from "../../../application/sync/syncAllowance";

interface UseSyncAllowanceResult {
  status: SyncAllowanceStatus | null;
  /** The first answer has arrived (or failed). Decisions that depend on the plan should wait for this. */
  loaded: boolean;
  refresh: () => Promise<void>;
}

/**
 * The Free plan's monthly sync as the screen needs it: is a sync available, and if not, when. Read again whenever
 * `refreshKey` changes (a sync just finished). If the answer cannot be read it counts as "no limit": the database still
 * decides, and a failed status read must never stop anyone from working.
 */
export function useSyncAllowance(allowance: SyncAllowance, userId: string | null, refreshKey: unknown): UseSyncAllowanceResult {
  // The answer is tagged with the account it belongs to, so a different account never sees the previous one's.
  const [answer, setAnswer] = useState<{ userId: string; status: SyncAllowanceStatus | null } | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const request = ++requestRef.current;
    const status = await allowance.status().catch(() => null);
    if (request === requestRef.current) setAnswer({ userId, status });
  }, [allowance, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const current = userId !== null && answer?.userId === userId ? answer : null;
  return { status: current?.status ?? null, loaded: current !== null, refresh };
}
