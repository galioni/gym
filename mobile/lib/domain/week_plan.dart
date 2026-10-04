/// What the week-plan bar under the session title shows (port of the logic in `WeekPlanBar.tsx`).
///
/// A plan either has a schedule (days of the week assigned to sessions) or is just an ordered list of sessions to get
/// through in a week. Either way each slot is done, today's, next up, or overdue.
library;

import 'dates.dart';
import 'models.dart';
import 'templates.dart';

const dayAbbreviations = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/// The seven day keys (Monday first) of the week that contains [dateKey].
List<String> weekDates(String dateKey) {
  final d = fromLocalDateKey(dateKey);
  final mondayOffset = d.weekday == DateTime.sunday ? -6 : 1 - d.weekday;
  return [for (var i = 0; i < 7; i++) toLocalDateKey(DateTime(d.year, d.month, d.day + mondayOffset + i))];
}

/// A day counts as done once any item in it has been ticked.
bool isDayDone(DayData day) => [...day.warmup, ...day.main].any((i) => i.done);

class WeekPill {
  const WeekPill({
    required this.sessionType,
    required this.done,
    required this.isCurrent,
    required this.isNext,
    this.isOverdue = false,
    this.dayLabel,
  });

  final String sessionType;
  final bool done;

  /// This slot is the session being shown right now.
  final bool isCurrent;
  final bool isNext;
  final bool isOverdue;

  /// "Mo".."Su" in a scheduled plan; null in an ordered one.
  final String? dayLabel;
}

class WeekPlanView {
  const WeekPlanView({required this.label, required this.pills, required this.allDone});

  final String label;
  final List<WeekPill> pills;

  /// Every slot of the week is done, so the bar says "Week complete" instead of listing them.
  final bool allDone;
}

/// Null when there is nothing to show (an ordered plan with no sessions).
WeekPlanView? buildWeekPlan({
  required Plan plan,
  required Map<String, DayData> allData,
  required String currentDate,
  required String currentSessionType,
}) {
  final dates = weekDates(currentDate);
  final schedule = plan.schedule;
  final hasSchedule = schedule != null && schedule.isNotEmpty;

  if (hasSchedule) {
    final slots = [
      for (var day = 0; day < 7; day++)
        if (schedule['$day'] != null)
          (
            day: day,
            sessionType: schedule['$day']!,
            done: () {
              final entry = allData[dates[day]];
              return entry != null && isDayDone(entry) && entry.sessionType == schedule['$day'];
            }(),
          ),
    ];
    final today = mondayIndex(fromLocalDateKey(currentDate));
    var next = slots.indexWhere((s) => !s.done && s.day >= today);
    if (next == -1) next = slots.indexWhere((s) => !s.done);
    return WeekPlanView(
      label: plan.label,
      allDone: next == -1 && slots.isNotEmpty,
      pills: [
        for (var i = 0; i < slots.length; i++)
          WeekPill(
            sessionType: slots[i].sessionType,
            done: slots[i].done,
            isCurrent: !slots[i].done && slots[i].sessionType == currentSessionType,
            isNext: i == next,
            isOverdue: !slots[i].done && i != next && slots[i].day < today,
            dayLabel: dayAbbreviations[slots[i].day],
          ),
      ],
    );
  }

  // Ordered mode: a ticked day this week uses up the first not-yet-used slot of its session type.
  final doneCounts = <String, int>{};
  for (final date in dates) {
    final day = allData[date];
    if (day != null && isDayDone(day)) doneCounts[day.sessionType] = (doneCounts[day.sessionType] ?? 0) + 1;
  }
  final consumed = <String, int>{};
  final slots = <({String sessionType, bool done})>[];
  for (final sessionType in plan.sessionIds) {
    final used = consumed[sessionType] ?? 0;
    final done = used < (doneCounts[sessionType] ?? 0);
    if (done) consumed[sessionType] = used + 1;
    slots.add((sessionType: sessionType, done: done));
  }
  if (slots.isEmpty) return null;
  final next = slots.indexWhere((s) => !s.done);
  return WeekPlanView(
    label: plan.label,
    allDone: next == -1,
    pills: [
      for (var i = 0; i < slots.length; i++)
        WeekPill(
          sessionType: slots[i].sessionType,
          done: slots[i].done,
          isCurrent: !slots[i].done && slots[i].sessionType == currentSessionType,
          isNext: i == next,
        ),
    ],
  );
}

/// The session the active plan schedules for [now]'s weekday, or null when it has no schedule or nothing for that day.
String? scheduledSessionFor(Plan? plan, DateTime now) => plan?.schedule?['${mondayIndex(now)}'];
