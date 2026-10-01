import { describe, expect, it, vi } from "vitest";
import type { PostgrestClient } from "@supabase/postgrest-js";
import { PostgrestSyncAllowance } from "./PostgrestSyncAllowance";
import { SyncAllowanceError } from "../../application/sync/syncAllowance";

type Reply = { data: unknown; error: { code?: string; message: string; details?: string } | null };

function allowanceWith(reply: Reply) {
  const rpc = vi.fn(async () => reply);
  return { allowance: new PostgrestSyncAllowance({ rpc } as unknown as PostgrestClient), rpc };
}

function allowanceByRpc(replies: { begin_sync: Reply; sync_allowance: Reply }) {
  const rpc = vi.fn(async (name: "begin_sync" | "sync_allowance") => replies[name]);
  return { allowance: new PostgrestSyncAllowance({ rpc } as unknown as PostgrestClient), rpc };
}

const ALLOWED: Reply = { data: [{ allowed: true }], error: null };
const status = (enforced: boolean, isPro: boolean): Reply => ({
  data: [{ enforced, is_pro: isPro, window_ends_at: null, next_available_at: null }],
  error: null,
});

describe("PostgrestSyncAllowance.begin", () => {
  it("lets a Free sync through with the 7-day cloud history window", async () => {
    const { allowance, rpc } = allowanceByRpc({ begin_sync: ALLOWED, sync_allowance: status(true, false) });
    await expect(allowance.begin()).resolves.toEqual({ historyDays: 7 });
    expect(rpc).toHaveBeenCalledWith("begin_sync");
  });

  it("puts no history limit on Pro", async () => {
    const { allowance } = allowanceByRpc({ begin_sync: ALLOWED, sync_allowance: status(true, true) });
    await expect(allowance.begin()).resolves.toEqual({ historyDays: null });
  });

  it("puts no history limit on anyone while the allowance is switched off", async () => {
    const { allowance } = allowanceByRpc({ begin_sync: ALLOWED, sync_allowance: status(false, false) });
    await expect(allowance.begin()).resolves.toEqual({ historyDays: null });
  });

  it("does not run the sync when the plan cannot be read", async () => {
    const { allowance } = allowanceByRpc({
      begin_sync: ALLOWED,
      sync_allowance: { data: null, error: { code: "08006", message: "connection failure" } },
    });
    await expect(allowance.begin()).rejects.toThrow(/connection failure/);
  });

  it("refuses with the date the next sync opens when the monthly sync has been used", async () => {
    const { allowance } = allowanceWith({
      data: null,
      error: { code: "PT423", message: "The Free plan syncs once every 30 days", details: "2026-11-01T10:00:00Z" },
    });
    const refusal = await allowance.begin().catch((e) => e);
    expect(refusal).toBeInstanceOf(SyncAllowanceError);
    expect((refusal as SyncAllowanceError).nextAvailableAt).toBe("2026-11-01T10:00:00.000Z");
  });

  it("does not block anyone when the database has not been migrated yet", async () => {
    const { allowance } = allowanceWith({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(allowance.begin()).resolves.toEqual({ historyDays: null });
  });

  it("reports any other failure, so the sync is retried later instead of running unchecked", async () => {
    const { allowance } = allowanceWith({ data: null, error: { code: "08006", message: "connection failure" } });
    await expect(allowance.begin()).rejects.toThrow(/connection failure/);
  });
});

describe("PostgrestSyncAllowance.status", () => {
  it("maps the database columns", async () => {
    const { allowance } = allowanceWith({
      data: [{ enforced: true, is_pro: false, window_ends_at: null, next_available_at: "2026-11-01T10:00:00+00:00" }],
      error: null,
    });
    expect(await allowance.status()).toEqual({
      enforced: true,
      isPro: false,
      windowEndsAt: null,
      nextAvailableAt: "2026-11-01T10:00:00+00:00",
    });
  });

  it("means no limit when the database has not been migrated yet", async () => {
    const { allowance } = allowanceWith({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect((await allowance.status()).enforced).toBe(false);
  });

  it("reports other failures", async () => {
    const { allowance } = allowanceWith({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(allowance.status()).rejects.toThrow(/boom/);
  });
});
