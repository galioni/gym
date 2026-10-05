/// Local data is not stored per account, and sync would upload it to whoever is signed in. This records which
/// account the data on this device belongs to so sync can refuse to cross accounts (`syncOwner.ts` in the web app).
library;

import '../sync/sync_service.dart';
import 'local_database.dart';

/// "claimed": nothing was recorded yet, so this device's existing data is assigned to this account (it predates
/// accounts or was created while signed in). "mismatch": the data belongs to someone else.
enum OwnerCheck { owned, claimed, mismatch }

class SqliteSyncOwner {
  SqliteSyncOwner(this._store);

  final LocalDatabase _store;

  static const _key = 'sync_owner';

  OwnerCheck check(String userId) {
    try {
      final owner = _store.readDoc(_key);
      if (owner == userId) return OwnerCheck.owned;
      if (owner == null) {
        _store.writeDoc(_key, userId);
        return OwnerCheck.claimed;
      }
      return OwnerCheck.mismatch;
    } catch (_) {
      // Storage unavailable: owners cannot be compared, so do not sync.
      return OwnerCheck.mismatch;
    }
  }

  /// Removes everything this device holds for any account (deleting the account). The device belongs to nobody afterwards.
  void clearAll() {
    _store.transaction(() {
      _store.db.execute('DELETE FROM days');
      _store.db.execute('DELETE FROM tombstones');
      _store.db.execute('DELETE FROM restore_points');
      // Preferences of the device itself (`device.*`, e.g. the theme) are not an account's data and stay.
      _store.db.execute("DELETE FROM docs WHERE key NOT LIKE 'device.%'");
    });
  }

  /// Removes the previous account's data from this device and assigns the device to [userId].
  void switchOwner(String userId) {
    _store.transaction(() {
      _store.db.execute('DELETE FROM days');
      _store.db.execute('DELETE FROM tombstones');
      _store.db.execute('DELETE FROM restore_points');
      // Preferences of the device itself (`device.*`, e.g. the theme) are not an account's data and stay.
      _store.db.execute("DELETE FROM docs WHERE key NOT LIKE 'device.%'");
      _store.writeDoc(_key, userId);
    });
  }
}

/// The ownership guard the sync service asks before every sync, for whichever user is signed in now.
class SyncOwnerGuard implements SyncOwnership {
  SyncOwnerGuard(this._owner, this._currentUserId);

  final SqliteSyncOwner _owner;
  final String? Function() _currentUserId;

  @override
  Future<OwnerStatus> check() async {
    final userId = _currentUserId();
    return userId != null && _owner.check(userId) == OwnerCheck.mismatch ? OwnerStatus.otherAccount : OwnerStatus.ok;
  }
}
