/// Port of `application/sync/syncErrors.ts` and the error half of `syncAllowance.ts`.
library;

/// The account has reached a storage limit enforced by the database (SQLSTATE PT422). Retrying cannot
/// succeed until the user deletes something, and nothing is lost: the data stays on this device.
class CloudLimitError implements Exception {
  CloudLimitError(this.table, this.message);

  final String table;
  final String message;

  @override
  String toString() => message;
}

const _tableLabels = {
  'workout_days': 'workout days',
  'templates': 'session templates',
  'plans': 'plans',
};

/// What to say when the database refuses a workout day older than a Free account's window (SQLSTATE PT424). The app already holds
/// such days back, using the device's date, so this almost always means the device's date or time is days out. Same wording as
/// `describeHistoryWindow` in the web app.
String describeHistoryWindow() =>
    "The cloud refused a day older than the last 7 days that the Free plan keeps. This usually means this device's date or time is wrong, so please check it. Your data is safe on this device.";

/// Plain-language message for a limit error raised on [table].
String describeLimit(String table) {
  final what = _tableLabels[table] ?? 'items';
  return 'Your account has reached its cloud storage limit for $what. '
      'Your data is safe on this device; delete older $what to sync new ones.';
}

/// The account has used its sync for the period. A kind of cloud refusal: nothing is wrong, nothing is lost,
/// and the cloud accepts no more writes until [nextAvailableAt]. Extends [CloudLimitError] so a refusal in the
/// middle of a sync is handled exactly like a storage limit.
class SyncAllowanceError extends CloudLimitError {
  SyncAllowanceError(this.nextAvailableAt, [String message = 'The Free plan syncs once every 30 days.'])
      : super('sync', message);

  final String? nextAvailableAt;
}

/// A sync problem with a message that is safe to show and to record as the last error (a failed database call,
/// cloud data that failed its integrity check, missing configuration).
class SyncException implements Exception {
  const SyncException(this.message);

  final String message;

  @override
  String toString() => message;
}
