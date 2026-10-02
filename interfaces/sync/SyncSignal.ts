/**
 * A hint from the server that the signed-in user's data changed somewhere else (another device wrote to the cloud).
 * It carries no data: the answer is always to run the normal sync. It may never arrive (offline, Realtime down, not set up),
 * so it only makes syncs sooner; the poll and the focus and reconnect triggers remain the fallback.
 */
export interface SyncSignal {
  /** Starts listening for this user. Returns a function that stops. Never throws: a failed connection is simply silent. */
  subscribe(userId: string, onChange: () => void): () => void;
}
