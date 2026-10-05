/// Pure changes to a day (port of `WorkoutStateTransitions.ts`). Each returns a new [DayData]; nothing is mutated.
library;

import 'defaults.dart';
import 'models.dart';
import 'rules.dart';
import 'templates.dart';

enum WorkoutSection { warmup, main }

DayData toggleItemInSection(DayData day, WorkoutSection section, String id, bool done) {
  List<WorkoutItem> toggle(List<WorkoutItem> items) => [for (final i in items) i.id == id ? i.copyWith(done: done) : i];
  return section == WorkoutSection.warmup ? day.copyWith(warmup: toggle(day.warmup)) : day.copyWith(main: toggle(day.main));
}

DayData deleteItemInSection(DayData day, WorkoutSection section, String id) {
  List<WorkoutItem> without(List<WorkoutItem> items) => [for (final i in items) if (i.id != id) i];
  return section == WorkoutSection.warmup ? day.copyWith(warmup: without(day.warmup)) : day.copyWith(main: without(day.main));
}

/// Switches the session and refills both sections from its template, keeping notes, weight and the check-in.
/// Timers restart, because they time the sections that were just replaced.
DayData resetSectionsFromTemplate(
  String date,
  String sessionType,
  DayData day, {
  Templates templates = defaultTemplates,
  IdGenerator idGen = generateId,
}) {
  final fresh = createEmptyDay(date, sessionType, templates: templates, idGen: idGen);
  return day.copyWith(
    sessionType: sessionType,
    warmup: fresh.warmup,
    main: fresh.main,
    warmupTimerMs: 0,
    mainTimerMs: 0,
  );
}

/// A blank day for [sessionType] (everything cleared except which session it is).
DayData clearDayKeepingSession(
  String date,
  String sessionType, {
  Templates templates = defaultTemplates,
  IdGenerator idGen = generateId,
}) =>
    createEmptyDay(date, sessionType, templates: templates, idGen: idGen);
