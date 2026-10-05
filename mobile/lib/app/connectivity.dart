/// Whether the device has a network connection (the web app's `useOnlineStatus`). A connection is not the same as
/// reaching the server, so a failed sync is still recorded and retried; this only avoids trying while clearly offline.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

abstract interface class ConnectivityMonitor {
  bool get isOnline;

  /// Emits whenever the state changes.
  Stream<bool> get changes;

  void dispose();
}

class PlusConnectivityMonitor implements ConnectivityMonitor {
  PlusConnectivityMonitor([Connectivity? connectivity]) : _connectivity = connectivity ?? Connectivity() {
    unawaited(_connectivity.checkConnectivity().then(_update, onError: (_) {}));
    _subscription = _connectivity.onConnectivityChanged.listen(_update, onError: (_) {});
  }

  final Connectivity _connectivity;
  final _controller = StreamController<bool>.broadcast();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _online = true;

  void _update(List<ConnectivityResult> results) {
    final online = results.any((r) => r != ConnectivityResult.none);
    if (online == _online) return;
    _online = online;
    _controller.add(online);
  }

  @override
  bool get isOnline => _online;

  @override
  Stream<bool> get changes => _controller.stream;

  @override
  void dispose() {
    _subscription?.cancel();
    _controller.close();
  }
}

/// A connection state a test (or a platform without detection) controls by hand.
class ManualConnectivity implements ConnectivityMonitor {
  ManualConnectivity({this._online = true});

  final _controller = StreamController<bool>.broadcast();
  bool _online;

  void set(bool online) {
    if (online == _online) return;
    _online = online;
    _controller.add(online);
  }

  @override
  bool get isOnline => _online;

  @override
  Stream<bool> get changes => _controller.stream;

  @override
  void dispose() => _controller.close();
}
