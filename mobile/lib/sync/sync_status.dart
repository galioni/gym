/// What the user should be told about sync, most important first (port of `application/sync/syncStatus.ts`).
/// A problem outranks "syncing" so a failing account does not flicker between states every time an automatic retry
/// starts. Wording is pinned by contract/dashboard.fixtures.json.
library;

enum SyncStatusKind { attention, offline, syncing, synced, idle }

class SyncStatus {
  const SyncStatus(this.kind, this.label, this.detail);

  final SyncStatusKind kind;

  /// Short label for the header.
  final String label;

  /// One sentence for the settings screen and screen readers.
  final String detail;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/// "3 Nov 2026" for the date the next sync opens, in the reader's own calendar (en-GB, which writes "Sept").
String formatNextSync(String nextAvailableAt) {
  final d = DateTime.parse(nextAvailableAt).toLocal();
  return '${d.day} ${_months[d.month - 1]} ${d.year}';
}

String _ago(String iso, DateTime now) {
  final minutes = ((now.millisecondsSinceEpoch - DateTime.parse(iso).millisecondsSinceEpoch) / 60000).floor();
  if (minutes < 1) return 'just now';
  if (minutes < 60) return '$minutes min ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '$hours h ago';
  return '${hours ~/ 24} d ago';
}

SyncStatus deriveSyncStatus({
  required bool isSyncing,
  required bool isOnline,
  required int conflictCount,
  String? lastError,
  String? lastSyncedAt,

  /// Present for a Free account under the monthly allowance; its value is when the next sync opens (null: now).
  ({String? nextAvailableAt})? allowance,
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  if (conflictCount > 0) {
    return SyncStatus(
      SyncStatusKind.attention,
      'Needs attention',
      '$conflictCount ${conflictCount == 1 ? 'conflict needs' : 'conflicts need'} your decision. Nothing has been overwritten.',
    );
  }
  if (!isOnline) {
    return const SyncStatus(
      SyncStatusKind.offline,
      'Offline',
      "You're offline. Changes are saved on this device and will sync when you're back online.",
    );
  }
  if (lastError != null && lastError.isNotEmpty) {
    return SyncStatus(SyncStatusKind.attention, 'Sync problem', lastError);
  }
  if (isSyncing) return const SyncStatus(SyncStatusKind.syncing, 'Syncing', 'Syncing your data…');

  final freePlan = allowance == null
      ? ''
      : allowance.nextAvailableAt != null
          ? ' Free plan: the next sync is available on ${formatNextSync(allowance.nextAvailableAt!)}.'
          : ' Free plan: a sync is available now.';
  if (lastSyncedAt != null && lastSyncedAt.isNotEmpty) {
    return SyncStatus(
      SyncStatusKind.synced,
      'Synced',
      'Everything is up to date. Last synced ${_ago(lastSyncedAt, at)}.$freePlan',
    );
  }
  return SyncStatus(
    SyncStatusKind.idle,
    'Not synced yet',
    allowance != null ? 'Sync from Settings when you want to back up.$freePlan' : 'Your data will sync automatically.',
  );
}
