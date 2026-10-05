/// Port of `application/sync/syncAllowance.ts`: the Free plan's monthly sync. A sync asks permission first
/// ([SyncAllowance.begin]); a Free account without an open window is refused with the date its next sync opens.
library;

import 'sync_merge.dart' show freeHistoryDays;

class SyncAllowanceStatus {
  const SyncAllowanceStatus({
    required this.enforced,
    required this.isPro,
    this.windowEndsAt,
    this.nextAvailableAt,
  });

  static const unlimited = SyncAllowanceStatus(enforced: false, isPro: false);

  /// The database switch is on. When off, nobody is limited.
  final bool enforced;
  final bool isPro;

  /// The current sync window closes at this time, when one is open.
  final String? windowEndsAt;

  /// When the next sync opens; null means a sync is available now (or the plan has no limit).
  final String? nextAvailableAt;
}

/// What a permitted sync is told about its plan.
class SyncGrant {
  const SyncGrant({this.historyDays});

  /// The Free plan keeps this many days of history in the cloud: older days are not uploaded. Null: no limit.
  final int? historyDays;
}

abstract interface class SyncAllowance {
  /// Called at the start of every sync. Completes when the sync may go ahead; throws a
  /// [SyncAllowanceError] (from sync_errors.dart) when it may not.
  Future<SyncGrant> begin();
  Future<SyncAllowanceStatus> status();
}

/// The history window of the plan, or null when there is none (Pro, or the allowance switched off).
int? historyDaysFor(SyncAllowanceStatus? status) =>
    status != null && status.enforced && !status.isPro ? freeHistoryDays : null;

/// True when a Free account may start a sync right now.
bool canSyncNow(SyncAllowanceStatus? status) =>
    status == null || !status.enforced || status.isPro || status.nextAvailableAt == null || status.windowEndsAt != null;

/// Whether the person is on a limited plan right now (Free with the allowance switched on).
bool isAllowanceLimited(SyncAllowanceStatus? status) => status != null && status.enforced && !status.isPro;

/// The database puts the date the next sync opens in the error details as an ISO timestamp; anything else is ignored.
String? parseNextAvailable(Object? details) {
  if (details is! String) return null;
  final time = DateTime.tryParse(details);
  return time?.toUtc().toIso8601String();
}
