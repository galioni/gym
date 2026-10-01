import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, SYNC_OWNER_STORAGE_KEY, TEMPLATE_STORAGE_KEY } from "../../../constants";
import { SyncConflict, SyncNowResult } from "../../../application/sync/syncTypes";
import { useAutoSync, useCrossTabReload } from "./useAutoSync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUCCESS: SyncNowResult = { status: "success", conflicts: [], message: "Sync completed." };
const conflict = (path: string): SyncConflict => ({
  entity: "workoutData",
  localUpdatedAt: "a",
  cloudUpdatedAt: "b",
  previewPaths: [path],
});

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

function setup(overrides: Partial<Parameters<typeof useAutoSync>[0]> = {}) {
  const syncNow = vi.fn<(resolution?: unknown, options?: { automatic?: boolean; downloadOnly?: boolean }) => Promise<SyncNowResult>>(async () => SUCCESS);
  const handlers = {
    onLocalDataChanged: vi.fn(),
    onConflicts: vi.fn(),
    onStorageLimit: vi.fn(),
    onOwnerMismatch: vi.fn(),
  };
  const initialProps = {
    ready: true,
    userId: "user-1" as string | null,
    syncNow,
    changeSignal: {},
    ...handlers,
    ...overrides,
  };
  const hook = renderHook((props: typeof initialProps) => useAutoSync(props), { initialProps });
  return { syncNow, handlers, hook, initialProps };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });

describe("useAutoSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubStorage();
    setVisibility("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("when it syncs", () => {
    it("syncs once on mount when local data is loaded and a user is signed in, marked automatic", async () => {
      const { syncNow } = setup();
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(1);
      expect(syncNow).toHaveBeenCalledWith({}, { automatic: true, downloadOnly: false });
    });

    it("a download-only hook (the Free plan) asks the sync to send nothing", async () => {
      const { syncNow } = setup({ downloadOnly: true });
      await flush();
      expect(syncNow).toHaveBeenCalledWith({}, { automatic: true, downloadOnly: true });

    });

    it("does nothing until local data has loaded, then syncs as soon as it has", async () => {
      const { syncNow, hook, initialProps } = setup({ ready: false });
      await flush();
      expect(syncNow).not.toHaveBeenCalled();

      hook.rerender({ ...initialProps, ready: true });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it("does nothing without a signed-in user", async () => {
      const { syncNow } = setup({ userId: null });
      await flush();
      await advance(10 * 60_000);
      expect(syncNow).not.toHaveBeenCalled();
    });

    it("syncs a few seconds after local edits, and a burst of edits produces a single sync", async () => {
      const { syncNow, hook, initialProps } = setup();
      await flush();
      syncNow.mockClear();

      hook.rerender({ ...initialProps, changeSignal: {} });
      await advance(1000);
      hook.rerender({ ...initialProps, changeSignal: {} });
      await advance(1000);
      hook.rerender({ ...initialProps, changeSignal: {} });
      await advance(2900);
      expect(syncNow).not.toHaveBeenCalled();

      await advance(200);
      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it("syncs when the connection comes back", async () => {
      const { syncNow } = setup();
      await flush();
      syncNow.mockClear();

      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it("skips while the browser reports it is offline", async () => {
      const { syncNow } = setup();
      await flush();
      syncNow.mockClear();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(syncNow).not.toHaveBeenCalled();
    });

    it("syncs when the tab regains focus, but not more than once every 15 seconds", async () => {
      const { syncNow } = setup();
      await flush();
      syncNow.mockClear();

      await advance(5_000);
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await flush();
      expect(syncNow).not.toHaveBeenCalled();

      await advance(11_000);
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it("polls every five minutes while visible, and not while hidden", async () => {
      const { syncNow } = setup();
      await flush();
      syncNow.mockClear();

      await advance(5 * 60_000);
      expect(syncNow).toHaveBeenCalledTimes(1);

      setVisibility("hidden");
      await advance(10 * 60_000);
      expect(syncNow).toHaveBeenCalledTimes(1);
    });
  });

  describe("single flight", () => {
    it("ignores new triggers while a sync is still running, then allows the next one", async () => {
      let finish: (value: SyncNowResult) => void = () => undefined;
      const { syncNow } = setup();
      await flush();
      syncNow.mockReset();
      syncNow.mockImplementation(() => new Promise<SyncNowResult>((resolve) => { finish = resolve; }));
      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(1);

      act(() => { window.dispatchEvent(new Event("online")); });
      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(1);

      await act(async () => { finish(SUCCESS); });
      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(2);
    });

    it("keeps working after a sync throws", async () => {
      const { syncNow } = setup();
      await flush();
      syncNow.mockClear();
      syncNow.mockRejectedValueOnce(new Error("boom"));
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(syncNow).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalledWith("[auto-sync] sync failed", expect.any(Error));
    });
  });

  describe("account ownership", () => {
    it("claims unowned local data for the signed-in user and syncs", async () => {
      const data = stubStorage();
      const { syncNow, handlers } = setup();
      await flush();
      expect(data.get(SYNC_OWNER_STORAGE_KEY)).toBe("user-1");
      expect(syncNow).toHaveBeenCalledTimes(1);
      expect(handlers.onOwnerMismatch).not.toHaveBeenCalled();
    });

    it("refuses to sync another account's data: asks once and never syncs afterwards", async () => {
      stubStorage({ [SYNC_OWNER_STORAGE_KEY]: "someone-else" });
      const { syncNow, handlers } = setup();
      await flush();

      expect(handlers.onOwnerMismatch).toHaveBeenCalledTimes(1);
      expect(syncNow).not.toHaveBeenCalled();

      act(() => { window.dispatchEvent(new Event("online")); });
      await advance(10 * 60_000);
      expect(syncNow).not.toHaveBeenCalled();
      expect(handlers.onOwnerMismatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("telling the user", () => {
    it("reloads in-memory state only when a sync changed local data", async () => {
      const { syncNow, handlers } = setup();
      await flush();
      expect(handlers.onLocalDataChanged).not.toHaveBeenCalled();

      syncNow.mockResolvedValueOnce({ ...SUCCESS, appliedToLocal: true });
      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(handlers.onLocalDataChanged).toHaveBeenCalledTimes(1);
    });

    it("reports a conflict once per distinct set of conflicts, and again after it clears", async () => {
      const { syncNow, handlers } = setup();
      await flush();
      const fire = async () => { act(() => { window.dispatchEvent(new Event("online")); }); await flush(); };

      syncNow.mockResolvedValue({ status: "conflict", conflicts: [conflict("2026-10-01.main")], message: "c" });
      await fire();
      await fire();
      expect(handlers.onConflicts).toHaveBeenCalledTimes(1);

      syncNow.mockResolvedValue({ status: "conflict", conflicts: [conflict("2026-10-02.main")], message: "c" });
      await fire();
      expect(handlers.onConflicts).toHaveBeenCalledTimes(2);

      syncNow.mockResolvedValue(SUCCESS);
      await fire();
      syncNow.mockResolvedValue({ status: "conflict", conflicts: [conflict("2026-10-02.main")], message: "c" });
      await fire();
      expect(handlers.onConflicts).toHaveBeenCalledTimes(3);
    });

    it("announces a storage limit once, stays quiet on retries, and announces again after a successful sync", async () => {
      const { syncNow, handlers } = setup();
      await flush();
      const fire = async () => { act(() => { window.dispatchEvent(new Event("online")); }); await flush(); };
      const limited: SyncNowResult = { status: "error", conflicts: [], message: "limit reached", reason: "storageLimit" };

      syncNow.mockResolvedValue(limited);
      await fire();
      await fire();
      expect(handlers.onStorageLimit).toHaveBeenCalledTimes(1);
      expect(handlers.onStorageLimit).toHaveBeenCalledWith("limit reached");

      syncNow.mockResolvedValue(SUCCESS);
      await fire();
      syncNow.mockResolvedValue(limited);
      await fire();
      expect(handlers.onStorageLimit).toHaveBeenCalledTimes(2);
    });

    it("does not announce ordinary failures as storage limits", async () => {
      const { syncNow, handlers } = setup();
      await flush();
      syncNow.mockResolvedValue({ status: "error", conflicts: [], message: "network down" });
      act(() => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(handlers.onStorageLimit).not.toHaveBeenCalled();
      expect(handlers.onConflicts).not.toHaveBeenCalled();
    });
  });

  it("stops listening when unmounted", async () => {
    const { syncNow, hook } = setup();
    await flush();
    syncNow.mockClear();
    hook.unmount();

    act(() => { window.dispatchEvent(new Event("online")); });
    await advance(10 * 60_000);
    expect(syncNow).not.toHaveBeenCalled();
  });
});

describe("useCrossTabReload", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reloads when another tab changes workouts or templates, and ignores unrelated keys", () => {
    const onChange = vi.fn();
    renderHook(() => useCrossTabReload(onChange));

    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY })); });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: TEMPLATE_STORAGE_KEY })); });
    expect(onChange).toHaveBeenCalledTimes(2);

    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "something-else" })); });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stops listening when unmounted", () => {
    const onChange = vi.fn();
    const hook = renderHook(() => useCrossTabReload(onChange));
    hook.unmount();
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY })); });
    expect(onChange).not.toHaveBeenCalled();
  });
});
