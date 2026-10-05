/**
 * The account has reached a storage limit enforced by the database (SQLSTATE PT422, see
 * supabase/migrations/*_row_limits.sql). Retrying cannot succeed until the user deletes something, and
 * nothing is lost: the data stays on this device.
 */
export class CloudLimitError extends Error {
  public constructor(
    public readonly table: string,
    message: string
  ) {
    super(message);
    this.name = "CloudLimitError";
  }
}

const TABLE_LABELS: Record<string, string> = {
  workout_days: "workout days",
  templates: "session templates",
  plans: "plans",
};

/**
 * What to say when the database refuses a workout day older than a Free account's window (SQLSTATE PT424, see
 * supabase/migrations/*_free_history_window.sql). The app already holds such days back, using the device's date, so this almost
 * always means the device's date or time is days out. Same wording in mobile/lib/sync/sync_errors.dart.
 */
export function describeHistoryWindow(): string {
  return "The cloud refused a day older than the last 7 days that the Free plan keeps. This usually means this device's date or time is wrong, so please check it. Your data is safe on this device.";
}

/** Plain-language message for a limit error raised on `table`. */
export function describeLimit(table: string): string {
  const what = TABLE_LABELS[table] ?? "items";
  return `Your account has reached its cloud storage limit for ${what}. Your data is safe on this device; delete older ${what} to sync new ones.`;
}
