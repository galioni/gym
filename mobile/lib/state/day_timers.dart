/// The two stopwatches of the day on screen, kept in step with the tracker.
///
/// They live above the screens, so a running timer survives opening Settings and coming back. Switching day pauses and
/// saves them onto the day they were timing first; after that each one shows the new day's stored time. Refilling the
/// lists for another session restarts them, because they timed the lists that were just replaced.
library;

import 'package:flutter/foundation.dart';

import '../domain/workout_transitions.dart';
import 'section_timer.dart';
import 'workout_tracker.dart';

class DayTimers extends ChangeNotifier {
  DayTimers(this._tracker, {DateTime Function() now = DateTime.now}) {
    warmup = SectionTimer(
      now: now,
      onSave: (ms) => _tracker.updateDay((d) => d.copyWith(warmupTimerMs: ms)),
    );
    main = SectionTimer(
      now: now,
      onSave: (ms) => _tracker.updateDay((d) => d.copyWith(mainTimerMs: ms)),
    );
    _boundDate = _tracker.currentDate;
    _boundSession = _tracker.currentDay.sessionType;
    _tracker.beforeDayChange = _saveRunning;
    _tracker.addListener(_follow);
    _follow();
    _running = runningSection;
    // The screen only needs to know which timer is running (the footer shortcut), not every tick; each timer's own
    // widget listens to its timer for those.
    warmup.addListener(_runningMayHaveChanged);
    main.addListener(_runningMayHaveChanged);
  }

  final WorkoutTracker _tracker;
  late final SectionTimer warmup;
  late final SectionTimer main;
  late String _boundDate;
  late String _boundSession;
  WorkoutSection? _running;

  void _runningMayHaveChanged() {
    final now = runningSection;
    if (now == _running) return;
    _running = now;
    notifyListeners();
  }

  SectionTimer timerFor(WorkoutSection section) => section == WorkoutSection.warmup ? warmup : main;

  /// The section whose timer is running now (for the "go to the timer" shortcut), the warm-up first.
  WorkoutSection? get runningSection => warmup.isRunning
      ? WorkoutSection.warmup
      : main.isRunning
          ? WorkoutSection.main
          : null;

  /// Pauses (and so saves) whatever is running, onto the day it was timing.
  void _saveRunning() {
    warmup.pause();
    main.pause();
  }

  /// Stores progress without stopping; call when the app goes to the background.
  void saveAll() {
    warmup.saveNow();
    main.saveNow();
  }

  void _follow() {
    final day = _tracker.currentDay;
    final sameDay = _tracker.currentDate == _boundDate;
    final sameSession = day.sessionType == _boundSession;
    _boundDate = _tracker.currentDate;
    _boundSession = day.sessionType;
    if (!sameDay || !sameSession) {
      // A different day, or a session that refilled the lists: whatever was timing is over.
      warmup.forceTo(day.warmupTimerMs);
      main.forceTo(day.mainTimerMs);
    } else {
      warmup.adopt(day.warmupTimerMs);
      main.adopt(day.mainTimerMs);
    }
  }

  @override
  void dispose() {
    _tracker.removeListener(_follow);
    if (_tracker.beforeDayChange == _saveRunning) _tracker.beforeDayChange = null;
    warmup.dispose();
    main.dispose();
    super.dispose();
  }
}
