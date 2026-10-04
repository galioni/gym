/// Things the app tells the user about that nobody asked for (a sync found a conflict, the account is full, another
/// account's data is on this device). The services publish them; the screen that is showing decides how to present them.
library;

import '../sync/sync_types.dart';

sealed class AppEvent {
  const AppEvent();
}

/// The same item changed on two devices; the user has to choose which version to keep (Settings > Sync).
class ConflictsFound extends AppEvent {
  const ConflictsFound(this.conflicts);

  final List<SyncConflict> conflicts;
}

/// The account reached a cloud storage limit. Local data is intact; new data cannot sync.
class StorageLimitReached extends AppEvent {
  const StorageLimitReached(this.message);

  final String message;
}

/// This device holds another account's data, so nothing syncs until the user chooses to switch or sign out.
class OwnerMismatch extends AppEvent {
  const OwnerMismatch();
}
