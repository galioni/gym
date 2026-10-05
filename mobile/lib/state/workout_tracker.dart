/// The state behind the day screen (port of `useWorkoutTracker.ts`): which day is shown, every day in memory, and saving.
///
/// Edits apply to memory at once and are saved to local storage right away, or after a short pause for text being typed.
/// Two things differ from the web hook on purpose: a save writes only the days that changed (one row each), and a save that
/// fails is kept and retried on the next flush instead of being dropped.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/repositories.dart';
import '../domain/dates.dart';
import '../domain/models.dart';
import '../domain/rules.dart';
import '../domain/templates.dart';
import '../domain/week_plan.dart';
import '../domain/workout_transitions.dart';

class WorkoutTracker extends ChangeNotifier {
  WorkoutTracker({
    required this._store,
    required this._templates,
    this._now = DateTime.now,
    this.noteDebounce = const Duration(milliseconds: 350),
    this.savingLinger = const Duration(milliseconds: 300),
    this.retryAfterFailure = const Duration(seconds: 5),
    this._idGen = generateId,
  }) : _currentDate = toLocalDateKey(_now());

  final WorkoutDayStore _store;
  final Templates Function() _templates;
  final DateTime Function() _now;
  final IdGenerator _idGen;

  /// How long typing must pause before notes are saved.
  final Duration noteDebounce;

  /// How long "Saving" stays visible after a save, so it can be seen at all.
  final Duration savingLinger;

  /// How long to wait before trying again after a save failed.
  final Duration retryAfterFailure;

  String _currentDate;
  var _allData = <String, DayData>{};
  bool _isLoaded = false;
  bool _isSaving = false;
  bool _disposed = false;
  String? _lastSaveError;

  /// Counts edits, so a read that started before an edit can tell that what it returned is already out of date.
  int _editRevision = 0;

  final _dirty = <String>{};
  final _removed = <String, DayData>{};
  Timer? _persistTimer;
  Timer? _lingerTimer;
  Future<void> _writing = Future.value();

  String get currentDate => _currentDate;

  /// The key of today in the local calendar.
  String get todayKey => toLocalDateKey(_now());
  bool get isLoaded => _isLoaded;

  /// A save is running (or just finished): the footer shows "Saving".
  bool get isSaving => _isSaving;

  /// Called just before the day on screen changes, while it is still the old day. Whatever is timing the old day saves
  /// itself here, so its time lands on the right day.
  VoidCallback? beforeDayChange;

  /// The last write failure, cleared by the next successful save. The edits are kept and retried.
  String? get lastSaveError => _lastSaveError;

  /// Every stored day, by date key. A new map on every change, so a widget can tell when it changed.
  Map<String, DayData> get allData => _allData;

  /// The day on screen. A day nobody has touched yet is a fresh one from its template and is only stored once edited.
  DayData get currentDay => _allData[_currentDate] ?? createEmptyDay(_currentDate, 'tennis', templates: _templates(), idGen: _idGen);

  Set<String> get usedSessionTypes => {for (final d in _allData.values) d.sessionType};

  bool get hasUnsavedChanges => _dirty.isNotEmpty || _removed.isNotEmpty;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> load() async {
    try {
      _allData = await _store.readAll();
    } catch (e) {
      debugPrint('Failed to load workout data: $e');
    } finally {
      _isLoaded = true;
      _notify();
    }
  }

  /// Storage changed underneath us (a sync wrote to it): read it again. Pending edits are saved first. If the user edits
  /// while we read, what was read is already out of date, so it is thrown away and read again after that edit is saved:
  /// an edit is never overwritten by older data. (The web hook only checks for an unsaved edit, which misses one that is
  /// saved the instant it is made.)
  Future<void> reload() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      await flush();
      final revision = _editRevision;
      final loaded = await _store.readAll();
      if (_disposed) return;
      if (revision != _editRevision || hasUnsavedChanges) continue;
      _allData = loaded;
      _notify();
      return;
    }
    // Still being edited after three tries: the next change signal reloads again.
  }

  void setCurrentDate(String dateKey) {
    if (dateKey == _currentDate) return;
    beforeDayChange?.call();
    // Save what is pending before switching days, so a debounced edit is never left behind.
    if (_persistTimer?.isActive ?? false) unawaited(flush());
    _currentDate = dateKey;
    _notify();
  }

  void jumpToToday() => setCurrentDate(toLocalDateKey(_now()));

  void shiftDay(int by) => setCurrentDate(shiftDateKey(_currentDate, by));

  /// Applies [change] to the day on screen. [debounce] delays the save (typing); zero saves now.
  void updateDay(DayData Function(DayData day) change, {Duration debounce = Duration.zero}) {
    final updated = change(currentDay);
    _editRevision++;
    _allData = {..._allData, _currentDate: updated};
    _dirty.add(_currentDate);
    _removed.remove(_currentDate);
    _notify();
    _schedulePersist(debounce);
  }

  /// [updateDay] for text being typed: saved after [noteDebounce] of quiet.
  void updateDayDebounced(DayData Function(DayData day) change) => updateDay(change, debounce: noteDebounce);

  void toggleItem(WorkoutSection section, String id, bool done) =>
      updateDay((d) => toggleItemInSection(d, section, id, done));

  void deleteItem(WorkoutSection section, String id) => updateDay((d) => deleteItemInSection(d, section, id));

  /// Switches the session and refills the day's lists from that session's template.
  void changeSessionType(String sessionType) => updateDay(
        (d) => resetSectionsFromTemplate(_currentDate, sessionType, d, templates: _templates(), idGen: _idGen),
      );

  void clearCurrentDay() => updateDay(
        (d) => clearDayKeepingSession(_currentDate, d.sessionType, templates: _templates(), idGen: _idGen),
      );

  /// Removes a stored day from the history. Its deletion is recorded so sync removes it everywhere.
  void deleteDay(String dateKey) {
    final removed = _allData[dateKey];
    if (removed == null) return;
    _editRevision++;
    _allData = {..._allData}..remove(dateKey);
    _dirty.remove(dateKey);
    _removed[dateKey] = removed;
    _notify();
    _schedulePersist(Duration.zero);
  }

  /// Copies yesterday's notes, check-in and weight onto the day on screen. False when yesterday has nothing stored.
  bool duplicatePreviousDayNotesAndWeight() {
    final previous = _allData[shiftDateKey(_currentDate, -1)];
    if (previous == null) return false;
    updateDay((d) => d.copyWith(
          warmupNotes: previous.warmupNotes,
          mainNotes: previous.mainNotes,
          checkNotes: previous.checkNotes,
          weight: previous.weight,
        ));
    return true;
  }

  /// When today has no data yet and the active plan schedules a session for this weekday, start the day with it. Does
  /// nothing for another date or a day the user has already started.
  void applyScheduledSession(Plan? plan) {
    if (!_isLoaded || _allData.containsKey(_currentDate) || _currentDate != toLocalDateKey(_now())) return;
    final scheduled = scheduledSessionFor(plan, _now());
    if (scheduled != null) changeSessionType(scheduled);
  }

  void _schedulePersist(Duration debounce) {
    _persistTimer?.cancel();
    _persistTimer = null;
    if (debounce > Duration.zero) {
      _persistTimer = Timer(debounce, () => unawaited(flush()));
    } else {
      unawaited(flush());
    }
  }

  /// Writes everything pending. Safe to call at any time; writes never overlap.
  Future<void> flush() {
    _persistTimer?.cancel();
    _persistTimer = null;
    return _writing = _writing.then((_) => _writePending());
  }

  Future<void> _writePending() async {
    if (!hasUnsavedChanges) return;
    final dates = {..._dirty};
    final removals = {..._removed};
    _dirty.clear();
    _removed.clear();
    _lingerTimer?.cancel();
    _isSaving = true;
    _notify();

    try {
      for (final e in removals.entries) {
        await _store.removeDay(e.key, e.value);
      }
      for (final date in dates) {
        final day = _allData[date];
        if (day != null) await _store.saveDay(day);
      }
      _lastSaveError = null;
    } catch (e) {
      debugPrint('Failed to save workout data: $e');
      _lastSaveError = 'Could not save your changes. They are kept and will be retried.';
      // Keep what did not get written; anything edited meanwhile is already marked.
      _dirty.addAll(dates);
      _removed.addAll({for (final e in removals.entries) if (!_removed.containsKey(e.key)) e.key: e.value});
      if (!_disposed) {
        _persistTimer?.cancel();
        _persistTimer = Timer(retryAfterFailure, () => unawaited(flush()));
      }
    }
    _lingerTimer = Timer(savingLinger, () {
      _isSaving = false;
      _notify();
    });
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _persistTimer?.cancel();
    _lingerTimer?.cancel();
    // Whatever is still pending is written; nobody is left to listen for the result.
    if (hasUnsavedChanges) unawaited(_writing = _writing.then((_) => _writePending()));
    super.dispose();
  }
}
