import { describe, expect, it } from "vitest";
import {
  SyncAllowanceError,
  SyncAllowanceStatus,
  canSyncNow,
  formatNextSync,
  isAllowanceLimited,
  parseNextAvailable,
} from "./syncAllowance";
import { CloudLimitError } from "./syncErrors";
import { deriveSyncStatus } from "./syncStatus";

const free = (over: Partial<SyncAllowanceStatus> = {}): SyncAllowanceStatus => ({
  enforced: true,
  isPro: false,
  windowEndsAt: null,
  nextAvailableAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

describe("who is limited, and when a sync is available", () => {
  it("limits only a Free account while the database switch is on", () => {
    expect(isAllowanceLimited(free())).toBe(true);
    expect(isAllowanceLimited(free({ isPro: true }))).toBe(false);
    expect(isAllowanceLimited(free({ enforced: false }))).toBe(false);
    expect(isAllowanceLimited(null)).toBe(false);
  });

  it("is available when there is no wait, when a window is open, or when nobody is limited", () => {
    expect(canSyncNow(free({ nextAvailableAt: null }))).toBe(true);
    expect(canSyncNow(free({ windowEndsAt: "2026-10-02T10:10:00.000Z" }))).toBe(true);
    expect(canSyncNow(free({ isPro: true }))).toBe(true);
    expect(canSyncNow(null)).toBe(true);
  });

  it("is not available while the monthly sync has been used", () => {
    expect(canSyncNow(free())).toBe(false);
  });
});

describe("the date the next sync opens", () => {
  it("reads the ISO timestamp the database puts in the error details", () => {
    expect(parseNextAvailable("2026-11-01T10:00:00Z")).toBe("2026-11-01T10:00:00.000Z");
  });

  it("ignores anything else instead of showing a broken date", () => {
    expect(parseNextAvailable(undefined)).toBeNull();
    expect(parseNextAvailable("")).toBeNull();
    expect(parseNextAvailable("soon")).toBeNull();
    expect(parseNextAvailable(42)).toBeNull();
  });

  it("is written as a short date", () => {
    expect(formatNextSync("2026-11-03T10:00:00.000Z", "en-GB")).toBe("3 Nov 2026");
  });
});

describe("SyncAllowanceError", () => {
  it("is a kind of cloud refusal, so a refusal mid-sync is handled like a storage limit", () => {
    const error = new SyncAllowanceError("2026-11-01T10:00:00.000Z");
    expect(error).toBeInstanceOf(CloudLimitError);
    expect(error.nextAvailableAt).toBe("2026-11-01T10:00:00.000Z");
  });
});

describe("sync status wording for a Free account", () => {
  const base = { isSyncing: false, isOnline: true, conflictCount: 0, lastError: null, now: Date.parse("2026-10-02T10:00:00Z") };

  it("says when the next sync opens, after a sync", () => {
    const status = deriveSyncStatus({ ...base, lastSyncedAt: "2026-10-02T09:00:00Z", allowance: { nextAvailableAt: "2026-11-01T09:00:00.000Z" } });
    expect(status.kind).toBe("synced");
    expect(status.detail).toContain("Free plan: the next sync is available on 1 Nov 2026");
  });

  it("says a sync is available when none has been used", () => {
    const status = deriveSyncStatus({ ...base, lastSyncedAt: null, allowance: { nextAvailableAt: null } });
    expect(status.kind).toBe("idle");
    expect(status.detail).toContain("a sync is available now");
  });

  it("does not mention a plan for someone with no limit", () => {
    const status = deriveSyncStatus({ ...base, lastSyncedAt: "2026-10-02T09:00:00Z", allowance: null });
    expect(status.detail).not.toContain("Free plan");
  });

  it("still puts conflicts and problems first", () => {
    expect(deriveSyncStatus({ ...base, lastSyncedAt: null, conflictCount: 1, allowance: { nextAvailableAt: null } }).kind).toBe("attention");
    expect(deriveSyncStatus({ ...base, lastSyncedAt: null, lastError: "boom", allowance: { nextAvailableAt: null } }).label).toBe("Sync problem");
  });
});
