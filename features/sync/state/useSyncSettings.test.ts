import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSyncSettings } from "./useSyncSettings";
import { SyncService } from "../../../application/sync/SyncService";
import { SyncNowResult } from "../../../application/sync/syncTypes";
import { SyncSettings } from "../../../interfaces/sync/SyncSettingsRepository";

function makeService(overrides: Partial<Record<string, unknown>> = {}): SyncService {
  return {
    getSettings: vi.fn().mockResolvedValue<SyncSettings>({
      mode: "cloud",
      lastSyncedAt: null,
      lastError: null,
    }),
    getRestorePoints: vi.fn().mockResolvedValue([]),
    syncNow: vi.fn().mockResolvedValue<SyncNowResult>({
      status: "success",
      conflicts: [],
      message: "Sync completed.",
    }),
    rollbackToRestorePoint: vi.fn().mockResolvedValue<SyncNowResult>({
      status: "success",
      conflicts: [],
      message: "Rollback completed from restore point.",
    }),
    ...overrides,
  } as unknown as SyncService;
}

describe("useSyncSettings", () => {
  it("loads settings and restore points on mount", async () => {
    const service = makeService({
      getSettings: vi.fn().mockResolvedValue<SyncSettings>({
        mode: "cloud",
        lastSyncedAt: "2026-04-01T10:00:00.000Z",
        lastError: null,
      }),
    });
    const { result } = renderHook(() => useSyncSettings(service));

    await waitFor(() => expect(result.current.settings.lastSyncedAt).toBe("2026-04-01T10:00:00.000Z"));
    expect(result.current.restorePoints).toEqual([]);
    expect(service.getSettings).toHaveBeenCalledOnce();
    expect(service.getRestorePoints).toHaveBeenCalledOnce();
  });

  it("starts with isSyncing false and no syncMessage", () => {
    const service = makeService();
    const { result } = renderHook(() => useSyncSettings(service));

    expect(result.current.isSyncing).toBe(false);
    expect(result.current.syncMessage).toBe("");
    expect(result.current.conflicts).toEqual([]);
  });

  it("sets isSyncing true while syncNow is in-flight and false when complete", async () => {
    let resolve!: (value: SyncNowResult) => void;
    const pending = new Promise<SyncNowResult>((res) => { resolve = res; });
    const service = makeService({ syncNow: vi.fn().mockReturnValue(pending) });
    const { result } = renderHook(() => useSyncSettings(service));

    act(() => { void result.current.syncNow(); });
    expect(result.current.isSyncing).toBe(true);

    await act(async () => {
      resolve({ status: "success", conflicts: [], message: "Sync completed." });
    });
    expect(result.current.isSyncing).toBe(false);
  });

  it("syncNow returns the result and updates syncMessage", async () => {
    const service = makeService();
    const { result } = renderHook(() => useSyncSettings(service));

    let syncResult!: SyncNowResult;
    await act(async () => {
      syncResult = await result.current.syncNow();
    });

    expect(syncResult.status).toBe("success");
    expect(result.current.syncMessage).toBe("Sync completed.");
  });

  it("syncNow exposes conflicts when status is conflict", async () => {
    const conflicts = [
      {
        entity: "workoutData" as const,
        localUpdatedAt: "2026-04-01T08:00:00.000Z",
        cloudUpdatedAt: "2026-04-01T09:00:00.000Z",
        previewPaths: ["2026-04-01.warmupNotes"],
      },
    ];
    const service = makeService({
      syncNow: vi.fn().mockResolvedValue<SyncNowResult>({
        status: "conflict",
        conflicts,
        message: "Conflicts detected.",
      }),
    });
    const { result } = renderHook(() => useSyncSettings(service));

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.conflicts).toEqual(conflicts);
    expect(result.current.syncMessage).toBe("Conflicts detected.");
  });

  it("syncNow refreshes settings from service after sync completes", async () => {
    const syncedAt = "2026-04-13T12:00:00.000Z";
    const getSettings = vi.fn()
      .mockResolvedValueOnce({ mode: "cloud", lastSyncedAt: null, lastError: null })
      .mockResolvedValueOnce({ mode: "cloud", lastSyncedAt: syncedAt, lastError: null });
    const service = makeService({ getSettings });
    const { result } = renderHook(() => useSyncSettings(service));

    await waitFor(() => expect(result.current.settings.lastSyncedAt).toBeNull());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.settings.lastSyncedAt).toBe(syncedAt);
  });

  it("rollbackToRestorePoint updates syncMessage and reloads settings", async () => {
    const service = makeService();
    const { result } = renderHook(() => useSyncSettings(service));

    await act(async () => {
      await result.current.rollbackToRestorePoint("point-123");
    });

    expect(service.rollbackToRestorePoint).toHaveBeenCalledWith("point-123");
    expect(result.current.syncMessage).toBe("Rollback completed from restore point.");
  });
});
