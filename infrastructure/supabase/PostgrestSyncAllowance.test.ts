import { describe, expect, it, vi } from "vitest";
import type { PostgrestClient } from "@supabase/postgrest-js";
import { PostgrestSyncAllowance } from "./PostgrestSyncAllowance";
import { SyncAllowanceError } from "../../application/sync/syncAllowance";

type Reply = { data: unknown; error: { code?: string; message: string; details?: string } | null };

function allowanceWith(reply: Reply) {
  const rpc = vi.fn(async () => reply);
  return { allowance: new PostgrestSyncAllowance({ rpc } as unknown as PostgrestClient), rpc };
}

describe("PostgrestSyncAllowance.begin", () => {
  it("lets the sync through when the database allows it", async () => {
    const { allowance, rpc } = allowanceWith({ data: [{ allowed: true }], error: null });
    await expect(allowance.begin()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("begin_sync");
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
    await expect(allowance.begin()).resolves.toBeUndefined();
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
