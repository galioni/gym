/// The exercises the template editor suggests while typing: every exercise ever logged, once each (port of
/// `exerciseLibrary.ts`; pinned by contract/editors.fixtures.json).
library;

import 'locale_compare.dart';
import 'models.dart';

class ExerciseLibraryEntry {
  const ExerciseLibraryEntry({required this.text, this.target});

  final String text;
  final String? target;
}

/// A deduplicated list from workout history. When two exercises share a name (ignoring case and surrounding spaces) the most
/// recently used one wins. Sorted alphabetically for display.
List<ExerciseLibraryEntry> buildExerciseLibrary(Map<String, DayData> allData) {
  final seen = <String, ExerciseLibraryEntry>{};
  // Newest first, so the first one met is the most recent.
  final days = allData.values.toList()..sort((a, b) => b.date.compareTo(a.date));
  for (final day in days) {
    for (final item in [...day.warmup, ...day.main]) {
      final key = item.text.trim().toLowerCase();
      if (key.isEmpty || seen.containsKey(key)) continue;
      final target = item.target;
      seen[key] = ExerciseLibraryEntry(text: item.text.trim(), target: target == null || target.isEmpty ? null : target);
    }
  }
  final entries = seen.values.toList();
  // Dart's sort is not stable, JavaScript's is: equal names keep their first-seen order.
  final indexed = [for (var i = 0; i < entries.length; i++) (i, entries[i])]..sort((a, b) {
      final c = localeCompare(a.$2.text, b.$2.text);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  return [for (final e in indexed) e.$2];
}

/// What to offer while [typed] is being entered: names that contain it (but are not exactly it), those starting with it first,
/// then alphabetical, at most eight.
List<ExerciseLibraryEntry> suggestExercises(String typed, List<ExerciseLibraryEntry> library) {
  final q = typed.trim().toLowerCase();
  if (q.isEmpty || library.isEmpty) return const [];
  final matches = [
    for (final e in library)
      if (e.text.toLowerCase() != q && e.text.toLowerCase().contains(q)) e,
  ];
  final indexed = [for (var i = 0; i < matches.length; i++) (i, matches[i])]..sort((a, b) {
      final aStart = a.$2.text.toLowerCase().startsWith(q) ? 0 : 1;
      final bStart = b.$2.text.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStart != bStart) return aStart - bStart;
      final c = localeCompare(a.$2.text, b.$2.text);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  return [for (final e in indexed.take(8)) e.$2];
}
