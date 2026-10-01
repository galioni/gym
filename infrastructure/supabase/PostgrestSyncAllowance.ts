import type { PostgrestClient } from "@supabase/postgrest-js";
import {
  SyncAllowance,
  SyncAllowanceError,
  SyncAllowanceStatus,
  SyncGrant,
  historyDaysFor,
  parseNextAvailable,
} from "../../application/sync/syncAllowance";

const ALLOWANCE_USED_CODE = "PT423";
// PostgREST's "function not found": the app can be live before the database migration is.
const FUNCTION_MISSING_CODE = "PGRST202";

const UNLIMITED: SyncAllowanceStatus = { enforced: false, isPro: false, windowEndsAt: null, nextAvailableAt: null };

interface AllowanceRow {
  enforced: boolean;
  is_pro: boolean;
  window_ends_at: string | null;
  next_available_at: string | null;
}

/**
 * The Free plan's monthly sync, as seen from the browser: `begin_sync()` is called at the start of every sync and
 * `sync_allowance()` tells the screen when the next one opens. Neither can hurt a Pro account or an installation whose
 * database has not been migrated yet: both then behave as "no limit".
 */
export class PostgrestSyncAllowance implements SyncAllowance {
  public constructor(private readonly client: PostgrestClient) {}

  public async begin(): Promise<SyncGrant> {
    const { error } = await this.client.rpc("begin_sync");
    if (error) {
      if (error.code === ALLOWANCE_USED_CODE) throw new SyncAllowanceError(parseNextAvailable(error.details));
      if (error.code === FUNCTION_MISSING_CODE) return { historyDays: null };
      throw new Error(`Could not start the sync: ${error.message}`);
    }
    // The plan decides what may be uploaded. If it cannot be read the sync does not run: guessing "no limit" could upload
    // days the plan does not keep, and guessing "limited" could hold back days a paying account is entitled to.
    return { historyDays: historyDaysFor(await this.status()) };
  }

  public async status(): Promise<SyncAllowanceStatus> {
    const { data, error } = await this.client.rpc("sync_allowance");
    if (error) {
      if (error.code === FUNCTION_MISSING_CODE) return UNLIMITED;
      throw new Error(`Could not read the sync allowance: ${error.message}`);
    }
    const row = (Array.isArray(data) ? data[0] : data) as AllowanceRow | undefined;
    if (!row) return UNLIMITED;
    return {
      enforced: row.enforced,
      isPro: row.is_pro,
      windowEndsAt: row.window_ends_at,
      nextAvailableAt: row.next_available_at,
    };
  }
}
