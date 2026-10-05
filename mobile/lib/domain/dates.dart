/// Date keys and small display helpers from the web app's `utils.ts`.
library;

import 'models.dart';

String _two(int n) => n.toString().padLeft(2, '0');

/// `YYYY-MM-DD` from the local calendar fields (stable day keys, no UTC drift).
String toLocalDateKey(DateTime date) => '${date.year.toString().padLeft(4, '0')}-${_two(date.month)}-${_two(date.day)}';

/// A local-midnight date for a `YYYY-MM-DD` key; today when the key is not made of numbers (as the web app does).
DateTime fromLocalDateKey(String key, [DateTime? now]) {
  final parts = key.split('-');
  final y = parts.isNotEmpty ? int.tryParse(parts[0]) : null;
  final m = parts.length > 1 ? int.tryParse(parts[1]) : null;
  final d = parts.length > 2 ? int.tryParse(parts[2]) : null;
  if (y == null || m == null || d == null) return now ?? DateTime.now();
  return DateTime(y, m, d);
}

/// The key of the day [by] days after [dateKey] (negative for earlier), across month and year ends.
String shiftDateKey(String dateKey, int by) {
  final d = fromLocalDateKey(dateKey);
  return toLocalDateKey(DateTime(d.year, d.month, d.day + by));
}

/// `mm:ss`, minutes not capped at 59 (a long session reads `75:00`).
String formatTimer(int ms) {
  final totalSeconds = ms ~/ 1000;
  return '${_two(totalSeconds ~/ 60)}:${_two(totalSeconds % 60)}';
}

/// Share of checklist items done, 0..100, rounded like JavaScript's `Math.round`.
int dayProgress(DayData day) {
  final total = day.warmup.length + day.main.length;
  if (total == 0) return 0;
  final done = day.warmup.where((i) => i.done).length + day.main.where((i) => i.done).length;
  return ((done / total) * 100).round();
}

/// Monday-first index of [date]'s weekday: 0 = Monday .. 6 = Sunday.
int mondayIndex(DateTime date) => date.weekday - 1;
