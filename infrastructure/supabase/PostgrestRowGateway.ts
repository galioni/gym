import { PostgrestClient } from "@supabase/postgrest-js";
import { AuthTokenProvider } from "../../interfaces/auth/AuthTokenProvider";
import { getRequiredSupabaseClientEnv } from "../auth/supabase/supabaseEnv";
import { CloudLimitError, describeLimit } from "../../application/sync/syncErrors";
import { SyncAllowanceError, parseNextAvailable } from "../../application/sync/syncAllowance";

export type UserTable = "workout_days" | "templates" | "plans" | "user_settings";

export interface AuthIdentityProvider {
  getUserId(): Promise<string | null>;
}

/**
 * The only operations the repositories need from the database. Keeping this narrow lets the repository
 * logic (diffing, mapping, deletes) be tested against an in-memory fake, and the real adapter against
 * the real stack.
 */
export interface RowGateway {
  /** Id of the signed-in user (also the value of user_id on every row written). */
  requireUserId(): Promise<string>;
  /** Every row of the signed-in user's table, in a stable order, across pages. */
  selectAll<T>(table: UserTable): Promise<T[]>;
  /** The rows of the signed-in user's table whose server-owned updated_at is at or after `since` (an ISO timestamp), across pages. */
  selectChangedSince<T>(table: UserTable, since: string): Promise<T[]>;
  upsertRows(table: UserTable, rows: object[]): Promise<void>;
  /** Soft-deletes workout days (sets deleted_at); a later upsert of the day restores it. */
  markDaysDeleted(days: Record<string, string>): Promise<void>;
  /** Removes rows whose key is not in `keep` (whole-collection replace semantics for templates/plans). */
  deleteMissing(table: "templates" | "plans", keep: string[]): Promise<void>;
}

// Stable total order so pages never overlap or skip rows.
const ORDER: Record<UserTable, string[]> = {
  workout_days: ["day"],
  templates: ["position", "session_type"],
  plans: ["position", "id"],
  user_settings: ["user_id"],
};
const KEY: Record<"templates" | "plans", string> = { templates: "session_type", plans: "id" };
const CONFLICT: Record<UserTable, string> = {
  workout_days: "user_id,day",
  templates: "user_id,session_type",
  plans: "user_id,id",
  user_settings: "user_id",
};
// Hosted Supabase caps a response at 1000 rows by default, so reads page and writes batch below that.
const PAGE_SIZE = 1000;
const WRITE_BATCH = 200;
// SQLSTATE the database raises when an account reaches a row limit (PostgREST returns it as HTTP 422).
const LIMIT_REACHED_CODE = "PT422";
// ... and when a Free account writes outside its monthly sync window (HTTP 423).
const ALLOWANCE_USED_CODE = "PT423";

function writeError(table: UserTable, action: string, error: { code?: string; message: string; details?: string }): Error {
  if (error.code === ALLOWANCE_USED_CODE) return new SyncAllowanceError(parseNextAvailable(error.details));
  return error.code === LIMIT_REACHED_CODE
    ? new CloudLimitError(table, describeLimit(table))
    : new Error(`Database ${action} failed (${table}): ${error.message}`);
}

/** A PostgREST client that sends the signed-in user's own token, which is what row level security evaluates. */
export function createUserPostgrestClient(tokenProvider: AuthTokenProvider): PostgrestClient {
  const env = getRequiredSupabaseClientEnv();
  return new PostgrestClient(`${env.url}/rest/v1`, {
    headers: { apikey: env.anonKey },
    fetch: async (input, init) => {
      const token = await tokenProvider.getAccessToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
  });
}

export class PostgrestRowGateway implements RowGateway {
  private readonly client: PostgrestClient;

  public constructor(
    private readonly tokenProvider: AuthTokenProvider,
    private readonly identity: AuthIdentityProvider
  ) {
    this.client = createUserPostgrestClient(this.tokenProvider);
  }

  public async requireUserId(): Promise<string> {
    const userId = await this.identity.getUserId();
    if (!userId) {
      throw new Error("Missing authenticated session. Sign in again and retry sync.");
    }
    return userId;
  }

  public async selectAll<T>(table: UserTable): Promise<T[]> {
    return this.selectPages<T>(table, null);
  }

  public async selectChangedSince<T>(table: UserTable, since: string): Promise<T[]> {
    return this.selectPages<T>(table, since);
  }

  private async selectPages<T>(table: UserTable, since: string | null): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = this.client.from(table).select("*");
      if (since !== null) query = query.gte("updated_at", since);
      for (const column of ORDER[table]) {
        query = query.order(column, { ascending: true });
      }
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Database read failed (${table}): ${error.message}`);
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  public async upsertRows(table: UserTable, rows: object[]): Promise<void> {
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      const { error } = await this.client
        .from(table)
        .upsert(rows.slice(i, i + WRITE_BATCH), { onConflict: CONFLICT[table] });
      if (error) throw writeError(table, "write", error);
    }
  }

  public async markDaysDeleted(days: Record<string, string>): Promise<void> {
    const userId = await this.requireUserId();
    // The database blanks a deleted day's content, so each day carries the hash its content had. Days that share a
    // hash (typically a few identical empty days) go in one request.
    const byHash = new Map<string, string[]>();
    for (const [day, hash] of Object.entries(days)) byHash.set(hash, [...(byHash.get(hash) ?? []), day]);

    const deletedAt = new Date().toISOString();
    for (const [hash, sameHash] of byHash) {
      for (let i = 0; i < sameHash.length; i += WRITE_BATCH) {
        const { error } = await this.client
          .from("workout_days")
          .update({ deleted_at: deletedAt, deleted_hash: hash })
          .eq("user_id", userId)
          .in("day", sameHash.slice(i, i + WRITE_BATCH))
          .is("deleted_at", null);
        if (error) throw new Error(`Database delete failed (workout_days): ${error.message}`);
      }
    }
  }

  public async deleteMissing(table: "templates" | "plans", keep: string[]): Promise<void> {
    const userId = await this.requireUserId();
    const column = KEY[table];
    const existing = await this.client.from(table).select(column).eq("user_id", userId);
    if (existing.error) throw new Error(`Database read failed (${table}): ${existing.error.message}`);
    const keepSet = new Set(keep);
    const stale = ((existing.data ?? []) as unknown as Array<Record<string, string>>)
      .map((row) => row[column])
      .filter((key) => !keepSet.has(key));
    for (let i = 0; i < stale.length; i += WRITE_BATCH) {
      const { error } = await this.client
        .from(table)
        .delete()
        .eq("user_id", userId)
        .in(column, stale.slice(i, i + WRITE_BATCH));
      if (error) throw new Error(`Database delete failed (${table}): ${error.message}`);
    }
  }
}
