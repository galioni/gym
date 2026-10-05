/// Keeps this device and the cloud in step without the user pressing anything (port of `useAutoSync.ts`): after sign-in,
/// shortly after local edits, when the server says another device changed something, when the connection returns, when
/// the app comes back to the foreground, and every few minutes. Failures are silent here (they are recorded in the sync
/// settings and retried by the next trigger).
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../sync/sync_signal.dart';
import '../sync/sync_types.dart';

typedef SyncRunner = Future<SyncNowResult> Function({bool automatic, bool downloadOnly});

class AutoSync {
  AutoSync({
    required this._syncNow,
    required this.onLocalDataChanged,
    required this.onConflicts,
    required this.onStorageLimit,
    required this.onOwnerMismatch,
    required this.hasOwnerMismatch,
    this.signal,
    this._now = DateTime.now,
    this.editDebounce = const Duration(seconds: 3),
    this.focusMinInterval = const Duration(seconds: 15),
    this.pollEvery = const Duration(minutes: 5),
    this.signalDebounce = const Duration(milliseconds: 1500),
    this.rerunDelay = const Duration(milliseconds: 500),
  });

  final SyncRunner _syncNow;
  final DateTime Function() _now;

  /// A sync changed local storage: reload in-memory state from it.
  final VoidCallback onLocalDataChanged;

  /// A sync needs the user to choose between local and cloud.
  final void Function(List<SyncConflict> conflicts) onConflicts;

  /// The account hit a database storage limit; local data is intact but new data cannot sync.
  final void Function(String message) onStorageLimit;

  /// This device holds another account's data; sync is paused until the user decides.
  final VoidCallback onOwnerMismatch;

  /// Whether the data on this device belongs to someone other than [userId].
  final bool Function(String userId) hasOwnerMismatch;

  /// The server's "your data changed elsewhere" hint. Without it the poll and the other triggers still run.
  final SyncSignal? signal;

  /// Several statements in a row (a sync writes days, then templates, then plans) send several signals: act once.
  final Duration signalDebounce;
  final Duration editDebounce;
  final Duration focusMinInterval;
  final Duration pollEvery;

  /// A trigger that arrived during a sync is answered this long after it ends.
  final Duration rerunDelay;

  bool _ready = false;
  String? _userId;
  bool _downloadOnly = false;
  bool _online = true;
  bool _foreground = true;
  bool _started = false;
  bool _disposed = false;

  bool _running = false;
  bool _rerun = false;
  DateTime? _lastRun;
  String? _ownerCheckedFor;
  bool _ownerBlocked = false;
  String _conflictSignature = '';
  bool _limitNotified = false;

  Timer? _editTimer;
  Timer? _signalTimer;
  Timer? _rerunTimer;
  Timer? _pollTimer;
  void Function()? _stopSignal;

  /// Tells it what it may do. [ready]: local data has finished loading (never sync before this). [downloadOnly]: automatic
  /// syncs only bring the cloud's data here and send nothing (a Free account uploads by hand, once a month).
  /// Any change runs a sync, like signing in does.
  void configure({required bool ready, required String? userId, required bool downloadOnly}) {
    final changed = ready != _ready || userId != _userId || downloadOnly != _downloadOnly;
    _ready = ready;
    _userId = userId;
    _downloadOnly = downloadOnly;
    _resubscribeSignal();
    if (changed) unawaited(run());
  }

  /// Begins the poll. Call once.
  void start() {
    if (_started) return;
    _started = true;
    _pollTimer = Timer.periodic(pollEvery, (_) {
      if (_foreground) unawaited(run());
    });
  }

  /// Local data changed: sync soon, once the edits have paused.
  void localChanged() {
    _editTimer?.cancel();
    _editTimer = Timer(editDebounce, () => unawaited(run()));
  }

  void setOnline(bool online) {
    final wasOffline = !_online;
    _online = online;
    if (online && wasOffline) unawaited(run());
  }

  void setForeground(bool foreground) {
    _foreground = foreground;
    if (foreground && (_lastRun == null || _now().difference(_lastRun!) > focusMinInterval)) unawaited(run());
  }

  /// The user decided about another account's data, so the next sync may check again.
  void ownerResolved() {
    _ownerBlocked = false;
    _ownerCheckedFor = null;
  }

  void _resubscribeSignal() {
    _stopSignal?.call();
    _stopSignal = null;
    _signalTimer?.cancel();
    final s = signal;
    final userId = _userId;
    // Only where this device syncs on its own: a Free account does not, so it does not listen either.
    if (s == null || !_ready || userId == null || _downloadOnly) return;
    _stopSignal = s.subscribe(userId, () {
      _signalTimer?.cancel();
      _signalTimer = Timer(signalDebounce, () => unawaited(run()));
    });
  }

  /// Runs one automatic sync if everything allows it.
  Future<void> run() async {
    final userId = _userId;
    if (_disposed || !_ready || userId == null || _ownerBlocked || !_online) return;
    if (_running) {
      // Dropping this trigger would leave the change unsynced until the next poll: the running sync may already have
      // read local data. Remember it and run again when this one ends.
      _rerun = true;
      return;
    }

    if (_ownerCheckedFor != userId) {
      _ownerCheckedFor = userId;
      if (hasOwnerMismatch(userId)) {
        _ownerBlocked = true;
        onOwnerMismatch();
        return;
      }
    }

    _running = true;
    _lastRun = _now();
    try {
      final result = await _syncNow(automatic: true, downloadOnly: _downloadOnly);
      if (result.appliedToLocal == true) onLocalDataChanged();
      if (result.status == SyncOutcome.conflict) {
        // Tell the user once per distinct set of conflicts, not on every retry.
        final signature = result.conflicts.map((c) => '${c.entity.name}:${c.previewPaths.join('|')}').join(';');
        if (signature != _conflictSignature) {
          _conflictSignature = signature;
          onConflicts(result.conflicts);
        }
      } else {
        _conflictSignature = '';
      }
      // Tell the user once; stay quiet on retries until a sync gets through again.
      if (result.reason == SyncFailReason.storageLimit) {
        if (!_limitNotified) {
          _limitNotified = true;
          onStorageLimit(result.message);
        }
      } else if (result.status == SyncOutcome.success) {
        _limitNotified = false;
      }
    } catch (e) {
      // Triggers fire this without awaiting it; a failure must not escape as an unhandled error or wedge the loop. The
      // next trigger simply tries again.
      debugPrint('[auto-sync] sync failed: $e');
    } finally {
      _running = false;
      if (_rerun && !_disposed) {
        _rerun = false;
        _rerunTimer?.cancel();
        _rerunTimer = Timer(rerunDelay, () => unawaited(run()));
      }
    }
  }

  void dispose() {
    _disposed = true;
    _editTimer?.cancel();
    _signalTimer?.cancel();
    _rerunTimer?.cancel();
    _pollTimer?.cancel();
    _stopSignal?.call();
  }
}
