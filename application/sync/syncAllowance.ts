import { CloudLimitError } from "./syncErrors";
import { FREE_HISTORY_DAYS } from "./historyWindow";

/**
 * The Free plan syncs once every 30 days (see supabase/migrations/*_sync_allowance.sql). A sync asks for permission first
 * (`begin`); a Free account without an open window is refused with the date its next sync opens.
 */
export interface SyncAllowanceStatus {
  /** The database switch is on. When off, nobody is limited. */
  enforced: boolean;
  isPro: boolean;
  /** The current sync window closes at this time, when one is open. */
  windowEndsAt: string | null;
  /** When the next sync opens; null means a sync is available now (or the plan has no limit). */
  nextAvailableAt: string | null;
}

/** What a permitted sync is told about its plan. */
export interface SyncGrant {
  /** The Free plan keeps this many days of history in the cloud: older days are not uploaded. Null means no such limit. */
  historyDays: number | null;
}

export interface SyncAllowance {
  /** Called at the start of every sync. Resolves when the sync may go ahead; throws SyncAllowanceError when it may not. */
  begin(): Promise<SyncGrant>;
  status(): Promise<SyncAllowanceStatus>;
}

/**
 * The account has used its sync for the period. It is a kind of cloud refusal: nothing is wrong, nothing is lost, and the
 * cloud simply accepts no more writes until the date. Extends CloudLimitError so a refusal in the middle of a sync is handled
 * exactly like a storage limit (what the cloud accepted is recorded and the rest waits).
 */
export class SyncAllowanceError extends CloudLimitError {
  public constructor(
    public readonly nextAvailableAt: string | null,
    message = "The Free plan syncs once every 30 days."
  ) {
    super("sync", message);
    this.name = "SyncAllowanceError";
  }
}

/** The history window of the plan, or null when there is none (Pro, or the allowance switched off). */
export function historyDaysFor(status: SyncAllowanceStatus | null): number | null {
  return status && status.enforced && !status.isPro ? FREE_HISTORY_DAYS : null;
}

/** True when a Free account may start a sync right now. */
export function canSyncNow(status: SyncAllowanceStatus | null): boolean {
  return !status || !status.enforced || status.isPro || status.nextAvailableAt === null || status.windowEndsAt !== null;
}

/** Whether the person is on a limited plan right now (Free with the allowance switched on). */
export function isAllowanceLimited(status: SyncAllowanceStatus | null): boolean {
  return Boolean(status && status.enforced && !status.isPro);
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/** "3 Nov 2026" for the date the next sync opens, in the reader's locale. */
export function formatNextSync(nextAvailableAt: string, locale?: string): string {
  return new Date(nextAvailableAt).toLocaleDateString(locale ?? "en-GB", DATE_FORMAT);
}

/** The database puts the date the next sync opens in the error details as an ISO timestamp; anything else is ignored. */
export function parseNextAvailable(details: unknown): string | null {
  if (typeof details !== "string") return null;
  const time = Date.parse(details);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
