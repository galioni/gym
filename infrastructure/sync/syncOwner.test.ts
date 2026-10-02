import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, SYNC_OWNER_STORAGE_KEY, TEMPLATE_STORAGE_KEY } from "../../constants";
import { checkSyncOwner, switchSyncOwner } from "./syncOwner";

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
  return data;
}

describe("syncOwner", () => {
  let data: Map<string, string>;
  beforeEach(() => { data = stubStorage(); });
  afterEach(() => vi.unstubAllGlobals());

  it("claims unowned data for the first account that signs in", () => {
    data.set(STORAGE_KEY, "{}");
    expect(checkSyncOwner("user-a")).toBe("claimed");
    expect(data.get(SYNC_OWNER_STORAGE_KEY)).toBe("user-a");
    expect(data.get(STORAGE_KEY)).toBe("{}");
  });

  it("recognises the owner on later sign-ins", () => {
    checkSyncOwner("user-a");
    expect(checkSyncOwner("user-a")).toBe("owned");
  });

  it("reports a mismatch for a different account without changing anything", () => {
    data.set(STORAGE_KEY, "{\"a\":1}");
    checkSyncOwner("user-a");
    expect(checkSyncOwner("user-b")).toBe("mismatch");
    expect(data.get(SYNC_OWNER_STORAGE_KEY)).toBe("user-a");
    expect(data.get(STORAGE_KEY)).toBe("{\"a\":1}");
  });

  it("switching removes the previous account's data and reassigns the browser", () => {
    data.set(STORAGE_KEY, "{\"a\":1}");
    data.set(TEMPLATE_STORAGE_KEY, "{}");
    checkSyncOwner("user-a");
    switchSyncOwner("user-b");
    expect(data.has(STORAGE_KEY)).toBe(false);
    expect(data.has(TEMPLATE_STORAGE_KEY)).toBe(false);
    expect(checkSyncOwner("user-b")).toBe("owned");
  });

  it("refuses to sync when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined, removeItem: () => undefined });
    expect(checkSyncOwner("user-a")).toBe("mismatch");
  });
});
