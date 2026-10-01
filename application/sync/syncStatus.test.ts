import { describe, expect, it } from "vitest";
import { deriveSyncStatus, SyncStatusInput } from "./syncStatus";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const base: SyncStatusInput = { isSyncing: false, isOnline: true, conflictCount: 0, lastError: null, lastSyncedAt: null, now: NOW };
const status = (overrides: Partial<SyncStatusInput>) => deriveSyncStatus({ ...base, ...overrides });

describe("deriveSyncStatus", () => {
  it("is idle before the first sync", () => {
    expect(status({}).kind).toBe("idle");
  });

  it("is synced after a successful sync, with a human time", () => {
    const synced = status({ lastSyncedAt: "2026-10-01T11:57:00.000Z" });
    expect(synced.kind).toBe("synced");
    expect(synced.detail).toContain("3 min ago");
    expect(status({ lastSyncedAt: "2026-10-01T11:59:50.000Z" }).detail).toContain("just now");
    expect(status({ lastSyncedAt: "2026-10-01T09:00:00.000Z" }).detail).toContain("3 h ago");
    expect(status({ lastSyncedAt: "2026-09-28T12:00:00.000Z" }).detail).toContain("3 d ago");
  });

  it("shows syncing while a sync runs", () => {
    expect(status({ isSyncing: true, lastSyncedAt: "2026-10-01T11:00:00.000Z" }).kind).toBe("syncing");
  });

  it("shows offline, and says changes are safe", () => {
    const offline = status({ isOnline: false, lastSyncedAt: "2026-10-01T11:00:00.000Z" });
    expect(offline.kind).toBe("offline");
    expect(offline.detail).toContain("saved on this device");
  });

  it("surfaces an error with its message", () => {
    const failed = status({ lastError: "Database write failed", lastSyncedAt: "2026-10-01T11:00:00.000Z" });
    expect(failed.kind).toBe("attention");
    expect(failed.detail).toBe("Database write failed");
  });

  it("asks for a decision on conflicts, singular and plural, and says nothing was overwritten", () => {
    expect(status({ conflictCount: 1 }).detail).toContain("1 conflict needs");
    expect(status({ conflictCount: 2 }).detail).toContain("2 conflicts need");
    expect(status({ conflictCount: 1 }).detail).toContain("Nothing has been overwritten");
  });

  describe("priority", () => {
    it("conflicts outrank everything, including offline and errors", () => {
      expect(status({ conflictCount: 1, isOnline: false, lastError: "x", isSyncing: true }).kind).toBe("attention");
      expect(status({ conflictCount: 1, isOnline: false }).label).toBe("Needs attention");
    });

    it("offline outranks a stale error (the error is just the lost connection)", () => {
      expect(status({ isOnline: false, lastError: "Failed to fetch" }).kind).toBe("offline");
    });

    it("an error outranks syncing, so a failing sync does not flicker on every retry", () => {
      expect(status({ lastError: "boom", isSyncing: true }).kind).toBe("attention");
    });
  });
});
