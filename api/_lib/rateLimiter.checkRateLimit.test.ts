import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit } from "./rateLimiter";

type RpcResult = { data: unknown; error: { message: string } | null };

function fakeDb(result: RpcResult | (() => RpcResult)) {
  const rpc = vi.fn(async () => (typeof result === "function" ? result() : result));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe("checkRateLimit (Postgres)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks the database to check and record in one step, with the limit and window given by the caller", async () => {
    const { db, rpc } = fakeDb({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
    await checkRateLimit("user-1", "generate-plan", 10, 3600, db);
    expect(rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_user: "user-1",
      p_route: "generate-plan",
      p_max: 10,
      p_window_seconds: 3600,
    });
  });

  it("allows a call the database allows", async () => {
    const { db } = fakeDb({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
    expect(await checkRateLimit("u", "r", 1, 60, db)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("refuses a call the database refuses, with the exact wait it reports", async () => {
    const { db } = fakeDb({ data: [{ allowed: false, retry_after_seconds: 1234 }], error: null });
    expect(await checkRateLimit("u", "r", 1, 86400, db)).toEqual({ allowed: false, retryAfterSeconds: 1234 });
  });

  it("accepts a single-object reply as well as an array", async () => {
    const { db } = fakeDb({ data: { allowed: false, retry_after_seconds: 7 }, error: null });
    expect(await checkRateLimit("u", "r", 1, 60, db)).toEqual({ allowed: false, retryAfterSeconds: 7 });
  });

  it("never tells a refused caller to retry in zero seconds", async () => {
    const { db } = fakeDb({ data: [{ allowed: false, retry_after_seconds: 0 }], error: null });
    expect((await checkRateLimit("u", "r", 1, 60, db)).retryAfterSeconds).toBe(1);
  });

  it("fails open and logs when the database returns an error", async () => {
    const { db } = fakeDb({ data: null, error: { message: "connection refused" } });
    expect(await checkRateLimit("u", "r", 1, 60, db)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(console.error).toHaveBeenCalled();
  });

  it("fails open when the database cannot be reached at all", async () => {
    const { db } = fakeDb(() => {
      throw new Error("network down");
    });
    expect((await checkRateLimit("u", "r", 1, 60, db)).allowed).toBe(true);
  });

  it("fails open on a reply it does not understand, instead of blocking everyone", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect((await checkRateLimit("u", "r", 1, 60, db)).allowed).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});
