import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_OWNER_STORAGE_KEY } from "../../../constants";
import { useSyncOwnerPrompt } from "./useSyncOwnerPrompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useSyncOwnerPrompt", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks when the browser holds another account's data, without waiting for any sync", () => {
    data.set(SYNC_OWNER_STORAGE_KEY, "account-a");
    const onMismatch = vi.fn();
    renderHook(() => useSyncOwnerPrompt("account-b", onMismatch));
    expect(onMismatch).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for the account that owns the data, and claims data nobody owned yet", () => {
    const onMismatch = vi.fn();
    data.set(SYNC_OWNER_STORAGE_KEY, "account-a");
    renderHook(() => useSyncOwnerPrompt("account-a", onMismatch));
    data.delete(SYNC_OWNER_STORAGE_KEY);
    renderHook(() => useSyncOwnerPrompt("account-b", onMismatch));
    expect(onMismatch).not.toHaveBeenCalled();
    expect(data.get(SYNC_OWNER_STORAGE_KEY)).toBe("account-b");
  });

  it("does nothing while nobody is signed in", () => {
    data.set(SYNC_OWNER_STORAGE_KEY, "account-a");
    const onMismatch = vi.fn();
    renderHook(() => useSyncOwnerPrompt(null, onMismatch));
    expect(onMismatch).not.toHaveBeenCalled();
  });
});
