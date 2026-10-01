import { CloudLimitError } from "../../application/sync/syncErrors";
import { RowGateway, UserTable } from "./PostgrestRowGateway";

/**
 * Test support: an in-memory stand-in for the database as seen by one signed-in user, with optional per-table caps that
 * behave like the row-limit trigger (a statement that would leave more live rows than the cap is refused whole; updating
 * an existing row never counts). Shared by the repository tests and the sync-under-limits tests.
 */
export type Row = Record<string, unknown>;

/** In-memory stand-in for the database as seen by one signed-in user. */
export class FakeGateway implements RowGateway {
  public tables: Record<UserTable, Map<string, Row>> = {
    workout_days: new Map(),
    templates: new Map(),
    plans: new Map(),
    user_settings: new Map(),
  };
  public upserted: Record<UserTable, number> = { workout_days: 0, templates: 0, plans: 0, user_settings: 0 };
  private clock = 0;

  private static key(table: UserTable, row: Row): string {
    return String(
      table === "workout_days" ? row.day : table === "templates" ? row.session_type : table === "user_settings" ? row.user_id : row.id
    );
  }

  public async requireUserId() { return "user-1"; }

  public async selectAll<T>(table: UserTable): Promise<T[]> {
    return [...this.tables[table].values()].map((row) => ({ ...row })) as T[];
  }

  /** Per-table cap on live rows, like the database trigger (an unset table is unlimited). */
  public caps: Partial<Record<UserTable, number>> = {};
  /** When set, every write is refused with this error (reads still work), like a Free account outside its sync window. */
  public refuseWrites: Error | null = null;

  public async upsertRows(table: UserTable, rows: object[]) {
    if (this.refuseWrites) throw this.refuseWrites;
    const cap = this.caps[table];
    if (cap !== undefined) {
      const isLive = (row: Row) => row.deleted_at == null;
      const incoming = new Set((rows as Row[]).map((row) => FakeGateway.key(table, row)));
      const surviving = [...this.tables[table].entries()].filter(([key, row]) => isLive(row) && !incoming.has(key)).length;
      if (surviving + incoming.size > cap) throw new CloudLimitError(table, `row limit reached for ${table}`);
    }
    for (const row of rows as Row[]) {
      this.tables[table].set(FakeGateway.key(table, row), { ...row, updated_at: new Date(Date.now() + ++this.clock).toISOString() });
      this.upserted[table] += 1;
    }
  }

  // Mirrors the database: the deleted_hash comes from the client, and the trigger blanks the content.
  public async markDaysDeleted(days: Record<string, string>) {
    if (this.refuseWrites) throw this.refuseWrites;
    for (const [day, hash] of Object.entries(days)) {
      const row = this.tables.workout_days.get(day);
      if (row && row.deleted_at === null) {
        Object.assign(row, {
          deleted_at: new Date().toISOString(),
          deleted_hash: hash,
          warmup: [],
          main: [],
          warmup_notes: "",
          main_notes: "",
          check_notes: "",
          weight: "",
          warmup_timer_ms: 0,
          main_timer_ms: 0,
        });
      }
    }
  }

  public async deleteMissing(table: "templates" | "plans", keep: string[]) {
    if (this.refuseWrites) throw this.refuseWrites;
    for (const key of [...this.tables[table].keys()]) {
      if (!keep.includes(key)) this.tables[table].delete(key);
    }
  }
}
