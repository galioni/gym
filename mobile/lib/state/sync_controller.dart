/// What the screens need to know about sync (port of `useSyncSettings.ts` and `useSyncAllowance.ts`): the last result,
/// whether a sync is running, conflicts waiting for a decision, restore points, and the Free plan's monthly allowance.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../sync/sync_allowance.dart';
import '../sync/sync_merge.dart' show ConflictResolution;
import '../sync/sync_service.dart';
import '../sync/sync_types.dart';

class SyncController extends ChangeNotifier {
  SyncController(this._service);

  final SyncService _service;
  bool _disposed = false;

  SyncSettings _settings = const SyncSettings();
  bool _isSyncing = false;
  List<SyncConflict> _conflicts = const [];
  List<RestorePoint> _restorePoints = const [];
  String _message = '';

  SyncSettings get settings => _settings;
  bool get isSyncing => _isSyncing;

  /// Conflicts the last sync could not decide, waiting for the user to keep one side.
  List<SyncConflict> get conflicts => _conflicts;

  /// Newest first.
  List<RestorePoint> get restorePoints => _restorePoints;

  /// The sentence describing the last sync or rollback.
  String get message => _message;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> load() async {
    final settings = await _service.getSettings();
    final points = await _service.getRestorePoints();
    if (_disposed) return;
    _settings = settings;
    _restorePoints = points;
    _notify();
  }

  /// Runs a sync and updates everything the screens show. Never throws: a failure is a result.
  Future<SyncNowResult> syncNow({
    ConflictResolutionMap resolution = const {},
    bool automatic = false,
    bool downloadOnly = false,
  }) async {
    _isSyncing = true;
    _notify();
    try {
      final result = await _service.syncNow(resolution: resolution, automatic: automatic, downloadOnly: downloadOnly);
      final settings = await _service.getSettings();
      final points = await _service.getRestorePoints();
      if (!_disposed) {
        _message = result.message;
        _conflicts = result.conflicts;
        _settings = settings;
        _restorePoints = points;
      }
      return result;
    } finally {
      _isSyncing = false;
      _notify();
    }
  }

  /// Keep one side for every conflict currently waiting, then sync again.
  Future<SyncNowResult> resolveAll(ConflictResolution choice) => syncNow(
        resolution: {for (final c in _conflicts) c.entity: choice},
      );

  Future<SyncNowResult> rollbackTo(String id) async {
    final result = await _service.rollbackToRestorePoint(id);
    final settings = await _service.getSettings();
    final points = await _service.getRestorePoints();
    if (!_disposed) {
      _message = result.message;
      _settings = settings;
      _restorePoints = points;
      _notify();
    }
    return result;
  }

  Future<void> pruneRestorePoints() async {
    await _service.pruneRestorePoints();
    final points = await _service.getRestorePoints();
    if (_disposed) return;
    _restorePoints = points;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// The Free plan's monthly sync as the screen needs it: is a sync available, and if not, when. If the answer cannot be
/// read it counts as "no limit": the database still decides, and a failed status read must never stop anyone working.
class AllowanceState extends ChangeNotifier {
  AllowanceState(this._allowance);

  final SyncAllowance _allowance;
  bool _disposed = false;
  int _request = 0;

  // The answer is tagged with the account it belongs to, so another account never sees the previous one's.
  ({String userId, SyncAllowanceStatus? status})? _answer;
  String? _userId;

  SyncAllowanceStatus? get status => _answer?.userId == _userId ? _answer?.status : null;

  /// The first answer has arrived (or failed). Decisions that depend on the plan should wait for this.
  bool get loaded => _userId != null && _answer?.userId == _userId;

  bool get isLimited => isAllowanceLimited(status);

  Future<void> refresh(String? userId) async {
    _userId = userId;
    if (userId == null) {
      _notify();
      return;
    }
    final request = ++_request;
    SyncAllowanceStatus? status;
    try {
      status = await _allowance.status();
    } catch (_) {
      status = null;
    }
    if (request == _request && !_disposed) {
      _answer = (userId: userId, status: status);
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
