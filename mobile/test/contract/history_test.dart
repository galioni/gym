import 'dart:convert';
import 'dart:io';

import 'package:daily_grind/domain/dates.dart';
import 'package:daily_grind/domain/history_stats.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// Replays contract/history.fixtures.json: the web app's own statistics code, run with "today" pinned.
typedef M = Map<String, dynamic>;

DayData dayFrom(Object? json) => DayData.fromJson((json as Map).cast<String, Object?>());

void main() {
  final f = jsonDecode(File('../contract/history.fixtures.json').readAsStringSync()) as M;
  final now = DateTime.fromMillisecondsSinceEpoch(f['today'] as int);

  test('set counts, including the readings that look odd', () {
    for (final c in f['targets'] as List) {
      expect(parseSetCount(c['target'] as String?), c['sets'], reason: jsonEncode(c['target']));
    }
  });

  test('weights typed as text', () {
    for (final c in f['weights'] as List) {
      expect(parseWeight(c['raw'] as String), (c['value'] as num?)?.toDouble(), reason: jsonEncode(c['raw']));
    }
  });

  test('week starts and headings', () {
    for (final c in f['weekStarts'] as List) {
      final start = weekStartOf(c['key'] as String);
      expect(start, c['weekStart'], reason: c['key'] as String);
      expect(weekLabel(start, now), c['label'], reason: c['key'] as String);
    }
    for (final c in f['labels'] as List) {
      expect(weekLabel(c['weekStart'] as String, now), c['label'], reason: c['weekStart'] as String);
    }
  });

  test('how days are named in the list and under the chart', () {
    for (final c in f['rowDates'] as List) {
      expect(rowDateLabel(c['key'] as String), c['row']);
      expect(chartDateLabel(c['key'] as String), c['chart']);
    }
  });

  test('progress bar tones', () {
    final expected = {'bg-emerald-500': ProgressTone.complete, 'bg-primary': ProgressTone.good, 'bg-amber-500': ProgressTone.low};
    for (final c in f['colors'] as List) {
      expect(progressTone(c['pct'] as int), expected[c['color']], reason: '${c['pct']}%');
    }
  });

  for (final c in f['histories'] as List) {
    test('history "${c['name']}": streak, this week, volume, totals, which days are worth listing', () {
      final all = {for (final e in (c['days'] as M).entries) e.key: dayFrom(e.value)};
      expect(calcStreak(all, now), c['streak']);
      expect(thisWeekCount(all, now), c['thisWeek']);
      expect(calcWeeklyVolume(all.values), c['volume']);
      expect(all.values.where(hasCompletedItems).length, c['total']);
      for (final w in c['worthy'] as List) {
        final d = all[w['date']]!;
        expect(hasCompletedItems(d), w['completed'], reason: w['date'] as String);
        expect(isWorthyDay(d), w['worthy'], reason: w['date'] as String);
        expect(dayProgress(d), w['progress'], reason: w['date'] as String);
      }
    });
  }

  group('grouping and the weight series (derived, so checked by hand)', () {
    DayData day(String date, {bool done = false, String weight = '', String notes = ''}) => DayData(
          date: date,
          sessionType: 'gym',
          main: [WorkoutItem(id: 'i', text: 'x', done: done)],
          weight: weight,
          mainNotes: notes,
        );

    test('worthy days only, newest first, grouped by week newest first', () {
      final groups = groupByWeek({
        '2026-10-03': day('2026-10-03', done: true),
        '2026-10-01': day('2026-10-01', notes: 'felt ok'),
        '2026-09-30': day('2026-09-30'), // nothing done, nothing written: not listed
        '2026-09-28': day('2026-09-28', weight: '80'),
        '2026-09-21': day('2026-09-21', done: true),
      });
      expect(groups.map((g) => g.weekStart), ['2026-09-28', '2026-09-21']);
      expect(groups.first.days.map((d) => d.date), ['2026-10-03', '2026-10-01', '2026-09-28']);
    });

    test('an empty history has no groups', () => expect(groupByWeek({}), isEmpty));

    test('the weight series is in date order, skips unreadable weights, and keeps the latest 90', () {
      final all = {
        for (var i = 0; i < 100; i++) toLocalDateKey(DateTime(2026, 1, 1 + i)): day(toLocalDateKey(DateTime(2026, 1, 1 + i)), weight: '${70 + i % 5}'),
        '2026-12-01': day('2026-12-01', weight: 'abc'),
      };
      final series = weightSeries(all);
      expect(series, hasLength(90));
      expect(series.first.date, toLocalDateKey(DateTime(2026, 1, 11)));
      expect(series.map((e) => e.date), orderedEquals([...series.map((e) => e.date)]..sort()));
    });

    test('the movement label', () {
      WeightEntry e(double w) => WeightEntry('d', w);
      expect(weightDeltaLabel([e(80), e(79.5)]), '↓ 0.5 kg');
      expect(weightDeltaLabel([e(79), e(80.54)]), '↑ 1.5 kg');
      expect(weightDeltaLabel([e(80), e(81), e(80)]), 'no change');
      expect(formatKg(80), '80');
      expect(formatKg(79.5), '79.5');
    });
  });
}
