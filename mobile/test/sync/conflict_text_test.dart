import 'package:daily_grind/sync/conflict_text.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';

/// Expected strings come from running the web app's own functions (see conflict_text.dart).
void main() {
  group('formatConflictPath', () {
    String w(String p) => formatConflictPath(SyncEntity.workoutData, p);
    String t(String p) => formatConflictPath(SyncEntity.templates, p);

    test('a day on its own, and the plain fields', () {
      expect(w('2026-10-01'), '1 Oct');
      expect(w('2026-10-01.mainNotes'), '1 Oct — main notes');
      expect(w('2026-10-01.warmupNotes'), '1 Oct — warm-up notes');
      expect(w('2026-10-01.checkNotes'), '1 Oct — check-in notes');
      expect(w('2026-10-01.weight'), '1 Oct — body weight');
      expect(w('2026-10-01.sessionType'), '1 Oct — session type');
    });

    test('exercises are numbered from one and say what changed', () {
      expect(w('2026-10-01.main.0.done'), '1 Oct — main #1 (checked)');
      expect(w('2026-10-01.main.2.text'), '1 Oct — main #3 name');
      expect(w('2026-10-01.warmup.1.target'), '1 Oct — warm-up #2 target');
      expect(w('2026-10-01.warmup.3'), '1 Oct — warm-up #4');
      expect(w('2026-10-01.main'), '1 Oct — main');
      expect(w('2026-09-05.main.0.videoUrl'), '5 Sept — main #1');
    });

    test('September is "Sept", as en-GB writes it', () {
      expect(w('2026-09-30.warmupTimerMs'), '30 Sept — warmupTimerMs');
    });

    test('fields it has no words for, and keys that are not dates, pass through', () {
      expect(w('2026-10-01.mainTimerMs'), '1 Oct — mainTimerMs');
      expect(w('not-a-date.mainNotes'), 'not-a-date — main notes');
      expect(w(''), '');
    });

    test('templates are named from their id', () {
      expect(t('yoga'), 'Yoga');
      expect(t('leg-day.warmup'), 'Leg Day — warm-up');
      expect(t('leg-day.main.1.text'), 'Leg Day — main #2 name');
      expect(t('push_pull.main.0.target'), 'Push Pull — main #1 target');
      expect(t('yoga.label'), 'Yoga — label');
      expect(t('a-b_c.warmup.0'), 'A B C — warm-up #1');
    });

    test('plans are named by their label, settings by what they are', () {
      expect(formatConflictPath(SyncEntity.plans, 'Cut'), 'Plan "Cut"');
      expect(formatConflictPath(SyncEntity.plans, 'p1'), 'Plan "p1"');
      expect(formatConflictPath(SyncEntity.settings, 'activePlanId'), 'Active plan');
      expect(formatConflictPath(SyncEntity.settings, 'planParams'), 'Plan details');
      expect(formatConflictPath(SyncEntity.settings, 'planMeta'), 'Plan details');
    });
  });

  test('relative time', () {
    final now = DateTime.utc(2026, 10, 3, 12);
    String ago(int ms) => relativeTime(now.subtract(Duration(milliseconds: ms)).toIso8601String(), now);
    expect(
      [0, 30000, 59999, 60000, 3599999, 3600000, 86399999, 86400000, 9 * 86400000, -5000].map(ago).toList(),
      ['just now', 'just now', 'just now', '1m ago', '59m ago', '1h ago', '23h ago', '1d ago', '9d ago', 'just now'],
    );
  });

  test('conflict headings', () {
    expect(entityLabel(SyncEntity.workoutData), 'Workout data');
    expect(entityLabel(SyncEntity.templates), 'Templates');
    expect(entityLabel(SyncEntity.plans), 'Plans');
  });
}
