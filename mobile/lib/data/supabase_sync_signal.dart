/// Listens on the private Broadcast channel `sync:<user id>` that the database writes to after each change (see
/// supabase/migrations/*_realtime_sync_signal.sql). The channel is private: Realtime checks the user's own token
/// against a row level security policy, so a user can only hear their own channel. Anything going wrong (no
/// Realtime on this backend, a refused channel, a dropped socket) is ignored: the app's other sync triggers keep
/// working.
library;

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../sync/sync_signal.dart';

class SupabaseSyncSignal implements SyncSignal {
  SupabaseSyncSignal(this._client);

  final SupabaseClient _client;

  @override
  void Function() subscribe(String userId, void Function() onChange) {
    RealtimeChannel? channel;
    try {
      channel = _client.channel('sync:$userId', opts: const RealtimeChannelConfig(private: true))
        ..onBroadcast(event: 'changed', callback: (_) => onChange())
        ..subscribe();
    } catch (e) {
      debugPrint('[sync-signal] could not start listening: $e');
    }
    return () {
      final c = channel;
      if (c == null) return;
      channel = null;
      try {
        _client.removeChannel(c);
      } catch (_) {
        // Already closed.
      }
    };
  }
}
