/// The numbers and grouping on the History screen: streaks, weekly volume, week headings, and the body-weight series. Ported
/// from the web app's `HistoryPage.tsx` and `WeightChart.tsx`; pinned by contract/history.fixtures.json, which runs the web
/// code itself. Quirks are kept on purpose (for example `-5` reads as a weight of 5, and `12 x 3 x 2` counts as 12 sets).
library;

import 'dates.dart';
import 'models.dart';
import 'week_plan.dart';

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

bool hasCompletedItems(DayData day) => [...day.warmup, ...day.main].any((i) => i.done);

/// A day belongs in the history if something was ticked, or a note or weight was written.
bool isWorthyDay(DayData day) =>
    hasCompletedItems(day) ||
    day.warmupNotes.trim().isNotEmpty ||
    day.mainNotes.trim().isNotEmpty ||
    day.weight.trim().isNotEmpty;

/// The Monday (as a day key) of the week containing [dateKey].
String weekStartOf(String dateKey) => weekDates(dateKey).first;

/// "This week", "Last week", or the Monday's date ("14 Sept 2026").
String weekLabel(String weekStart, DateTime now) {
  final thisWeek = weekStartOf(toLocalDateKey(now));
  final lastWeek = shiftDateKey(thisWeek, -7);
  if (weekStart == thisWeek) return 'This week';
  if (weekStart == lastWeek) return 'Last week';
  final d = fromLocalDateKey(weekStart);
  return '${d.day} ${_months[d.month - 1]} ${d.year}';
}

/// "Sat 3 Oct": how a day is named in the list.
String rowDateLabel(String dateKey) {
  final d = fromLocalDateKey(dateKey);
  return '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]}';
}

/// "3 Oct": how a day is named under the weight chart.
String chartDateLabel(String dateKey) {
  final d = fromLocalDateKey(dateKey);
  return '${d.day} ${_months[d.month - 1]}';
}

/// Consecutive days with something ticked, ending today (or yesterday, if today has nothing ticked yet).
int calcStreak(Map<String, DayData> allData, DateTime now) {
  final today = allData[toLocalDateKey(now)];
  var check = today != null && hasCompletedItems(today)
      ? DateTime(now.year, now.month, now.day)
      : DateTime(now.year, now.month, now.day - 1);
  var streak = 0;
  while (true) {
    final day = allData[toLocalDateKey(check)];
    if (day == null || !hasCompletedItems(day)) return streak;
    streak++;
    check = DateTime(check.year, check.month, check.day - 1);
  }
}

/// Days with something ticked since Monday, up to now (a day later this week does not count yet).
int thisWeekCount(Map<String, DayData> allData, DateTime now) {
  final weekStart = fromLocalDateKey(weekStartOf(toLocalDateKey(now)));
  return allData.values.where((day) {
    if (!hasCompletedItems(day)) return false;
    final date = fromLocalDateKey(day.date);
    return !date.isBefore(weekStart) && !date.isAfter(now);
  }).length;
}

final _sets = RegExp(r'(\d+)\s*[x×]\s*\d+', caseSensitive: false);
final _setsOf = RegExp(r'(\d+)\s*sets?\s+of\s+\d+', caseSensitive: false);

/// The number of sets a target like "3x8" or "3 sets of 10" names; 0 when it names none.
int parseSetCount(String? target) {
  if (target == null || target.isEmpty) return 0;
  final m = _sets.firstMatch(target) ?? _setsOf.firstMatch(target);
  return m == null ? 0 : int.parse(m.group(1)!);
}

/// Sets in the main-session exercises that were ticked.
int calcWeeklyVolume(Iterable<DayData> days) => days.fold(
      0,
      (total, day) => total + day.main.where((i) => i.done).fold(0, (s, i) => s + parseSetCount(i.target)),
    );

/// How full a day's progress bar is drawn: complete, half or more, or less.
enum ProgressTone { complete, good, low }

ProgressTone progressTone(int percent) => percent == 100
    ? ProgressTone.complete
    : percent >= 50
        ? ProgressTone.good
        : ProgressTone.low;

final _notWeightChars = RegExp(r'[^\d.]');
final _leadingNumber = RegExp(r'^\d*\.?\d*');

/// A weight typed as free text ("79,5", " 80 kg ") as a number of kilograms, or null. Same reading as the web app's chart:
/// a comma is a decimal point, every other character that is not a digit or dot is dropped, then the leading number is used.
double? parseWeight(String raw) {
  if (raw.trim().isEmpty) return null;
  final cleaned = raw.replaceAll(',', '.').replaceAll(_notWeightChars, '');
  final lead = _leadingNumber.firstMatch(cleaned)!.group(0)!;
  final n = double.tryParse(lead.startsWith('.') ? '0$lead' : lead.endsWith('.') ? '${lead}0' : lead);
  return n != null && n.isFinite && n > 0 && n < 1000 ? n : null;
}

class WeightEntry {
  const WeightEntry(this.date, this.weight);

  final String date;
  final double weight;
}

/// The logged weights in date order, the latest 90.
List<WeightEntry> weightSeries(Map<String, DayData> allData) {
  final entries = [
    for (final d in allData.values)
      if (parseWeight(d.weight) case final w?) WeightEntry(d.date, w),
  ]..sort((a, b) => a.date.compareTo(b.date));
  return entries.length > 90 ? entries.sublist(entries.length - 90) : entries;
}

/// "79.5" or "80" (no trailing ".0").
String formatKg(double w) => w == w.truncateToDouble() ? w.toInt().toString() : w.toString();

/// "↑ 1.5 kg", "↓ 0.3 kg" or "no change": how the series moved from its first to its latest entry.
String weightDeltaLabel(List<WeightEntry> entries) {
  final delta = entries.last.weight - entries.first.weight;
  return delta == 0 ? 'no change' : '${delta > 0 ? '↑' : '↓'} ${delta.abs().toStringAsFixed(1)} kg';
}

class WeekGroup {
  const WeekGroup(this.weekStart, this.days);

  final String weekStart;

  /// Newest first.
  final List<DayData> days;
}

/// The days worth listing, newest first, grouped by the week they fall in (newest week first).
List<WeekGroup> groupByWeek(Map<String, DayData> allData) {
  final worthy = allData.values.where(isWorthyDay).toList()..sort((a, b) => b.date.compareTo(a.date));
  final groups = <WeekGroup>[];
  final byWeek = <String, List<DayData>>{};
  for (final day in worthy) {
    final start = weekStartOf(day.date);
    final list = byWeek.putIfAbsent(start, () {
      final fresh = <DayData>[];
      groups.add(WeekGroup(start, fresh));
      return fresh;
    });
    list.add(day);
  }
  return groups;
}
