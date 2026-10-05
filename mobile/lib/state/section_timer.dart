/// The stopwatch on a workout section (warm-up or main session).
///
/// Time is measured against the wall clock, not by counting ticks, so it stays right while the app is in the
/// background or the screen is off. While running it saves its progress every few seconds without stopping, and a
/// save is never mistaken for an outside change (the web timer used to reset itself on its own first autosave; fixed there
/// on 2026-10-03, see components/Timer.test.tsx).
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

class SectionTimer extends ChangeNotifier {
  SectionTimer({
    required this.onSave,
    this._now = DateTime.now,
    this.autosaveEvery = const Duration(seconds: 5),
    this.refreshEvery = const Duration(milliseconds: 200),
  });

  /// Called with the elapsed time whenever it should be stored.
  final void Function(int ms) onSave;
  final DateTime Function() _now;
  final Duration autosaveEvery;

  /// How often a running timer tells its widget to redraw.
  final Duration refreshEvery;

  int _baseMs = 0;
  DateTime? _startedAt;
  int? _lastSavedMs;
  Timer? _refresh;
  Timer? _autosave;
  bool _disposed = false;

  bool get isRunning => _startedAt != null;

  int get elapsedMs {
    final started = _startedAt;
    return _baseMs + (started == null ? 0 : _now().difference(started).inMilliseconds.clamp(0, 1 << 40));
  }

  void start() {
    if (isRunning) return;
    _startedAt = _now();
    _refresh = Timer.periodic(refreshEvery, (_) => _notify());
    _autosave = Timer.periodic(autosaveEvery, (_) => saveNow());
    _notify();
  }

  /// Stops, keeping the time, and saves it.
  void pause() {
    if (!isRunning) return;
    final ms = elapsedMs;
    _stopTimers();
    _baseMs = ms;
    _startedAt = null;
    _save(ms);
    _notify();
  }

  void toggle() => isRunning ? pause() : start();

  /// Back to zero, stopped, and saved.
  void reset() {
    _stopTimers();
    _startedAt = null;
    _baseMs = 0;
    _save(0);
    _notify();
  }

  /// Stores the current time without stopping (the app is going to the background).
  void saveNow() {
    if (isRunning) _save(elapsedMs);
  }

  /// The value stored for this section is [storedMs]. If that is just what this timer saved, nothing changed and the
  /// timer carries on; if it is something else (another day, a refilled session, data from a sync) the timer stops and
  /// shows it.
  void adopt(int storedMs) {
    if (storedMs == _lastSavedMs) return;
    forceTo(storedMs);
  }

  /// Stops and shows [ms], whatever was saved before.
  void forceTo(int ms) {
    _stopTimers();
    _startedAt = null;
    _baseMs = ms;
    _lastSavedMs = ms;
    _notify();
  }

  void _save(int ms) {
    _lastSavedMs = ms;
    onSave(ms);
  }

  void _stopTimers() {
    _refresh?.cancel();
    _autosave?.cancel();
    _refresh = null;
    _autosave = null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _stopTimers();
    super.dispose();
  }
}
