import { useEffect, useRef } from "react";
import { checkSyncOwner } from "../../../infrastructure/sync/syncOwner";

/**
 * As soon as someone is signed in, check whose data this browser holds. This must not wait for a sync to be due: a Free
 * account does not sync on its own once the browser has synced before, and without this check the previous account's
 * workouts would sit on screen, with no question asked, under the new account's name.
 */
export function useSyncOwnerPrompt(userId: string | null, onMismatch: () => void): void {
  const handler = useRef(onMismatch);
  useEffect(() => {
    handler.current = onMismatch;
  });
  useEffect(() => {
    if (!userId) return;
    if (checkSyncOwner(userId) === "mismatch") handler.current();
  }, [userId]);
}
