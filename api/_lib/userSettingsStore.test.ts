import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserSettings, setAiProvider } from "./userSettingsStore";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the slice of the Supabase client the store uses. */
class FakeDb {
  public rows: Row[] = [];
  public failWith: string | null = null;
  public lastUpsert: { row: Row; options: Row } | null = null;

  public from() {
    return {
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () =>
            this.failWith
              ? { data: null, error: { message: this.failWith } }
              : { data: this.rows.find((r) => r[column] === value) ?? null, error: null },
        }),
      }),
      upsert: async (row: Row, options: Row) => {
        this.lastUpsert = { row, options };
        if (this.failWith) return { error: { message: this.failWith } };
        const at = this.rows.findIndex((r) => r.user_id === row.user_id);
        // Like Postgres ON CONFLICT DO UPDATE with only the given columns: other columns keep their values.
        if (at >= 0) this.rows[at] = { ...this.rows[at], ...row };
        else this.rows.push(row);
        return { error: null };
      },
    };
  }
}

const asClient = (db: FakeDb) => db as unknown as SupabaseClient;

describe("user settings store (Postgres)", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("has no preference when there is no row", async () => {
    expect(await getUserSettings("u1", asClient(db))).toEqual({});
  });

  it("round-trips the chosen provider", async () => {
    await setAiProvider("u1", "anthropic", asClient(db));
    expect(await getUserSettings("u1", asClient(db))).toEqual({ aiProvider: "anthropic" });
    expect(db.lastUpsert?.options).toEqual({ onConflict: "user_id" });
  });

  it("writes only the provider, leaving the active plan the browser syncs untouched", async () => {
    db.rows.push({ user_id: "u1", active_plan_id: "plan-7", plan_params: { goal: "strength" } });
    await setAiProvider("u1", "openai", asClient(db));
    expect(Object.keys(db.lastUpsert!.row).sort()).toEqual(["ai_provider", "user_id"]);
    expect(db.rows[0]).toMatchObject({ active_plan_id: "plan-7", ai_provider: "openai" });
  });

  it("ignores an unknown stored value", async () => {
    db.rows.push({ user_id: "u1", ai_provider: "skynet" });
    expect(await getUserSettings("u1", asClient(db))).toEqual({});
  });

  it("falls back to no preference when the database cannot be read", async () => {
    db.failWith = "down";
    expect(await getUserSettings("u1", asClient(db))).toEqual({});
  });

  it("reports a failed save instead of pretending it worked", async () => {
    db.failWith = "readonly";
    await expect(setAiProvider("u1", "google", asClient(db))).rejects.toThrow(/readonly/);
  });
});
