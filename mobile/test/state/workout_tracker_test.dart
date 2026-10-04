import 'dart:async';

import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/repositories.dart';
import 'package:daily_grind/data/sqlite_repositories.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/domain/workout_transitions.dart';
import 'package:daily_grind/state/workout_tracker.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

final today = DateTime(2026, 10, 3, 12);
const todayKey = '2026-10-03', yesterdayKey = '2026-10-02';

DayData stored(String date, {String notes = '', String session = 'yoga', bool done = false, String weight = ''}) => DayData(
      date: date,
      sessionType: session,
      main: [WorkoutItem(id: 'i-$date', text: 'Move', done: done)],
      mainNotes: notes,
      weight: weight,
    );

Templates templates() => {
      'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
      'yoga': const TemplateData(
        warmup: [TemplateRow(id: 'w', text: 'Cat-cow')],
        main: [TemplateRow(id: 'm', text: 'Flow', target: '10 min')],
      ),
      'run': const TemplateData(main: [TemplateRow(id: 'r', text: 'Easy run')]),
    };

/// A store that fails the first [failures] writes, to exercise retry.
class FlakyStore implements WorkoutDayStore {
  FlakyStore(this.inner, {this.failures = 1});

  final WorkoutDayStore inner;
  int failures;
  int saveAttempts = 0;

  @override
  Future<Map<String, DayData>> readAll() => inner.readAll();

  @override
  Future<void> saveDay(DayData day) async {
    saveAttempts++;
    if (failures > 0) {
      failures--;
      throw StateError('disk full');
    }
    return inner.saveDay(day);
  }

  @override
  Future<void> removeDay(String date, DayData day) => inner.removeDay(date, day);
}

void main() {
  late LocalDatabase db;
  late SqliteWorkoutDataRepository repo;
  var ids = 0;

  setUp(() {
    db = LocalDatabase.inMemory();
    repo = SqliteWorkoutDataRepository(db);
    ids = 0;
  });
  tearDown(() => db.close());

  WorkoutTracker make({WorkoutDayStore? store}) =>
      WorkoutTracker(store: store ?? repo, templates: templates, now: () => today, idGen: () => 'g${ids++}');

  Future<WorkoutTracker> loaded({WorkoutDayStore? store}) async {
    final t = make(store: store);
    await t.load();
    return t;
  }

  group('loading', () {
    test('starts on today, empty, then shows stored days', () async {
      await repo.saveDay(stored(todayKey, notes: 'hello'));
      final t = make();
      expect([t.currentDate, t.isLoaded, t.allData], [todayKey, false, isEmpty]);
      await t.load();
      expect(t.isLoaded, isTrue);
      expect(t.currentDay.mainNotes, 'hello');
      t.dispose();
    });

    test('an unreadable store still finishes loading, with nothing', () async {
      final t = make(store: _BrokenStore());
      await t.load();
      expect([t.isLoaded, t.allData], [true, isEmpty]);
      t.dispose();
    });
  });

  group('the day on screen', () {
    test('an untouched day is a fresh one from the default session and is not stored until edited', () async {
      final t = await loaded();
      expect(t.currentDay.sessionType, 'tennis');
      expect(t.currentDay.main, isNotEmpty);
      expect(t.hasUnsavedChanges, isFalse);
      expect(await repo.readAll(), isEmpty);
      t.dispose();
    });

    test('changing the session refills the lists from its template, restarts timers, and is saved', () async {
      await repo.saveDay(stored(todayKey, notes: 'keep me').copyWith(mainTimerMs: 9000, weight: '80'));
      final t = await loaded();
      t.changeSessionType('run');
      await t.flush();

      final day = (await repo.readAll())[todayKey]!;
      expect(day.sessionType, 'run');
      expect(day.main.map((i) => i.text), ['Easy run']);
      expect(day.main.single.id, startsWith('g'));
      expect([day.mainTimerMs, day.mainNotes, day.weight], [0, 'keep me', '80']);
      t.dispose();
    });

    test('ticking and removing items is saved at once', () async {
      await repo.saveDay(stored(todayKey));
      final t = await loaded();
      t.toggleItem(WorkoutSection.main, 'i-$todayKey', true);
      await t.flush();
      expect((await repo.readAll())[todayKey]!.main.single.done, isTrue);

      t.deleteItem(WorkoutSection.main, 'i-$todayKey');
      await t.flush();
      expect((await repo.readAll())[todayKey]!.main, isEmpty);
      t.dispose();
    });

    test('clearing keeps the session but drops everything else', () async {
      await repo.saveDay(stored(todayKey, notes: 'gone', session: 'run', done: true, weight: '80'));
      final t = await loaded();
      t.clearCurrentDay();
      await t.flush();
      final day = (await repo.readAll())[todayKey]!;
      expect([day.sessionType, day.mainNotes, day.weight], ['run', '', '']);
      expect(day.main.map((i) => i.text), ['Easy run']);
      expect(day.main.single.done, isFalse);
      t.dispose();
    });

    test('every change produces a new map, so widgets can tell something changed', () async {
      final t = await loaded();
      final before = t.allData;
      t.changeSessionType('yoga');
      expect(identical(before, t.allData), isFalse);
      t.dispose();
    });
  });

  group('saving', () {
    test('typed text is saved only after a pause; typing again restarts the wait', () {
      fakeAsync((async) {
        final t = make();
        t.load();
        async.flushMicrotasks();

        t.updateDayDebounced((d) => d.copyWith(mainNotes: 'a'));
        async.elapse(const Duration(milliseconds: 300));
        t.updateDayDebounced((d) => d.copyWith(mainNotes: 'ab'));
        async.elapse(const Duration(milliseconds: 300));
        async.flushMicrotasks();
        expect(t.hasUnsavedChanges, isTrue, reason: 'only 300ms since the last keystroke');

        async.elapse(const Duration(milliseconds: 100));
        async.flushMicrotasks();
        expect(t.hasUnsavedChanges, isFalse);
        late Map<String, DayData> saved;
        repo.readAll().then((v) => saved = v);
        async.flushMicrotasks();
        expect(saved[todayKey]!.mainNotes, 'ab');
        t.dispose();
        async.flushTimers();
      });
    });

    test('switching day saves a pending typed edit first', () async {
      final t = await loaded();
      t.updateDayDebounced((d) => d.copyWith(mainNotes: 'typed'));
      t.setCurrentDate(yesterdayKey);
      await t.flush();
      expect((await repo.readAll())[todayKey]!.mainNotes, 'typed');
      t.dispose();
    });

    test('"Saving" shows during a save and lingers briefly afterwards', () {
      fakeAsync((async) {
        final t = make();
        t.load();
        async.flushMicrotasks();
        t.changeSessionType('run');
        async.flushMicrotasks();
        expect(t.isSaving, isTrue, reason: 'the write has finished but "Saving" is still showing');
        async.elapse(const Duration(milliseconds: 301));
        expect(t.isSaving, isFalse);
        t.dispose();
        async.flushTimers();
      });
    });

    test('a failed save keeps the edit, reports it, and the next flush writes it', () async {
      final flaky = FlakyStore(repo);
      final t = await loaded(store: flaky);
      t.changeSessionType('run'); // saved straight away in the background, and that write fails
      await Future<void>.delayed(Duration.zero);
      expect(t.lastSaveError, isNotNull);
      expect(t.hasUnsavedChanges, isTrue);
      expect(await repo.readAll(), isEmpty);

      await t.flush();
      expect(t.lastSaveError, isNull);
      expect(t.hasUnsavedChanges, isFalse);
      expect((await repo.readAll())[todayKey]!.sessionType, 'run');
      expect(flaky.saveAttempts, 2);
      t.dispose();
    });

    test('after a failed save it tries again by itself', () {
      fakeAsync((async) {
        final flaky = FlakyStore(repo);
        final t = make(store: flaky);
        t.load();
        async.flushMicrotasks();
        t.changeSessionType('run');
        async.flushMicrotasks();
        expect(t.hasUnsavedChanges, isTrue);

        async.elapse(const Duration(seconds: 5));
        async.flushMicrotasks();
        expect(t.hasUnsavedChanges, isFalse);
        expect(t.lastSaveError, isNull);
        expect(flaky.saveAttempts, 2);
        t.dispose();
        async.flushTimers();
      });
    });

    test('writes never overlap: many quick edits end with the last one stored', () async {
      final t = await loaded();
      for (var i = 0; i < 20; i++) {
        t.updateDay((d) => d.copyWith(mainNotes: 'n$i'));
      }
      await t.flush();
      expect((await repo.readAll())[todayKey]!.mainNotes, 'n19');
      t.dispose();
    });

    test('closing the screen saves what is still pending', () async {
      final t = await loaded();
      t.updateDayDebounced((d) => d.copyWith(mainNotes: 'last words'));
      t.dispose();
      await Future<void>.delayed(Duration.zero);
      expect((await repo.readAll())[todayKey]!.mainNotes, 'last words');
    });
  });

  group('deleting a day', () {
    test('removes it from the history and records the deletion for sync', () async {
      await repo.saveDay(stored(yesterdayKey, notes: 'old'));
      final t = await loaded();
      t.deleteDay(yesterdayKey);
      expect(t.allData.containsKey(yesterdayKey), isFalse);
      await t.flush();

      expect(await repo.readAll(), isEmpty);
      expect((await repo.readSnapshot())!.deletedDays!.keys, [yesterdayKey]);
      t.dispose();
    });

    test('deleting a day that was never stored does nothing', () async {
      final t = await loaded();
      t.deleteDay('2026-01-01');
      expect(t.hasUnsavedChanges, isFalse);
      t.dispose();
    });

    test('writing the day again clears its deletion', () async {
      await repo.saveDay(stored(todayKey, notes: 'v1'));
      final t = await loaded();
      t.deleteDay(todayKey);
      await t.flush();
      t.updateDay((d) => d.copyWith(mainNotes: 'back again'));
      await t.flush();
      expect((await repo.readSnapshot())!.deletedDays, isEmpty);
      expect((await repo.readAll())[todayKey]!.mainNotes, 'back again');
      t.dispose();
    });
  });

  group('copying yesterday', () {
    test('copies notes, check-in and weight, not the exercises', () async {
      await repo.saveDay(stored(yesterdayKey, notes: 'felt strong', weight: '79.5').copyWith(warmupNotes: 'w', checkNotes: 'slept well'));
      final t = await loaded();
      expect(t.duplicatePreviousDayNotesAndWeight(), isTrue);
      final d = t.currentDay;
      expect([d.mainNotes, d.warmupNotes, d.checkNotes, d.weight], ['felt strong', 'w', 'slept well', '79.5']);
      expect(d.sessionType, 'tennis');
      t.dispose();
    });

    test('says so when there is no yesterday', () async {
      final t = await loaded();
      expect(t.duplicatePreviousDayNotesAndWeight(), isFalse);
      expect(t.hasUnsavedChanges, isFalse);
      t.dispose();
    });
  });

  group('moving between days', () {
    test('previous, next and today', () async {
      final t = await loaded();
      t.shiftDay(-1);
      expect(t.currentDate, yesterdayKey);
      t.shiftDay(2);
      expect(t.currentDate, '2026-10-04');
      t.jumpToToday();
      expect(t.currentDate, todayKey);
      t.dispose();
    });

    test('setting the same day notifies nobody', () async {
      final t = await loaded();
      var calls = 0;
      t.addListener(() => calls++);
      t.setCurrentDate(todayKey);
      expect(calls, 0);
      t.dispose();
    });
  });

  group('reload after a sync', () {
    test('picks up days another device brought', () async {
      final t = await loaded();
      await repo.saveDay(stored(yesterdayKey, notes: 'from the cloud'));
      await t.reload();
      expect(t.allData[yesterdayKey]!.mainNotes, 'from the cloud');
      t.dispose();
    });

    test('saves pending edits first, so a reload cannot lose them', () async {
      final t = await loaded();
      t.updateDayDebounced((d) => d.copyWith(mainNotes: 'typing'));
      await t.reload();
      expect(t.currentDay.mainNotes, 'typing');
      expect((await repo.readAll())[todayKey]!.mainNotes, 'typing');
      t.dispose();
    });

    test('an edit made while reading wins over the data that was read', () async {
      final slow = _SlowStore(repo);
      final t = await loaded(store: slow);
      final reloading = t.reload();
      await slow.reading.future;
      t.updateDay((d) => d.copyWith(mainNotes: 'edited during reload'));
      slow.release.complete();
      await reloading;
      expect(t.currentDay.mainNotes, 'edited during reload');
      expect(slow.reads, 2, reason: 'what was read before the edit was thrown away and read again');
      expect((await repo.readAll())[todayKey]!.mainNotes, 'edited during reload');
      t.dispose();
    });
  });

  group('scheduled session', () {
    // 2026-10-03 is a Saturday: index 5.
    const plan = Plan(id: 'p', label: 'P', sessionIds: ['run'], schedule: {'5': 'run', '0': 'yoga'});

    test('starts today with the session the plan schedules for this weekday', () async {
      final t = await loaded();
      t.applyScheduledSession(plan);
      expect(t.currentDay.sessionType, 'run');
      await t.flush();
      expect((await repo.readAll())[todayKey]!.sessionType, 'run');
      t.dispose();
    });

    test('leaves a day the user already started, another date, or a plan without a schedule alone', () async {
      await repo.saveDay(stored(todayKey, session: 'yoga'));
      final started = await loaded();
      started.applyScheduledSession(plan);
      expect(started.currentDay.sessionType, 'yoga');
      started.dispose();

      final other = await loaded();
      other.setCurrentDate(yesterdayKey);
      other.applyScheduledSession(plan);
      expect(other.hasUnsavedChanges, isFalse);
      other.dispose();

      final unscheduled = make();
      await unscheduled.load();
      unscheduled.applyScheduledSession(const Plan(id: 'q', label: 'Q', sessionIds: []));
      unscheduled.applyScheduledSession(null);
      expect(unscheduled.hasUnsavedChanges, isFalse);
      unscheduled.dispose();
    });

    test('does nothing before the history has loaded', () {
      final t = make();
      t.applyScheduledSession(plan);
      expect(t.hasUnsavedChanges, isFalse);
      t.dispose();
    });
  });
}

class _BrokenStore implements WorkoutDayStore {
  @override
  Future<Map<String, DayData>> readAll() => throw StateError('corrupt');

  @override
  Future<void> saveDay(DayData day) async {}

  @override
  Future<void> removeDay(String date, DayData day) async {}
}

/// Lets a test act while a read is in flight (after it started, before it returns).
class _SlowStore implements WorkoutDayStore {
  _SlowStore(this.inner);

  final WorkoutDayStore inner;
  var _first = true;
  final reading = Completer<void>();
  final release = Completer<void>();
  int reads = 0;

  @override
  Future<Map<String, DayData>> readAll() async {
    if (_first) {
      _first = false;
      return inner.readAll();
    }
    reads++;
    final data = await inner.readAll();
    if (!reading.isCompleted) reading.complete();
    await release.future;
    return data;
  }

  @override
  Future<void> saveDay(DayData day) => inner.saveDay(day);

  @override
  Future<void> removeDay(String date, DayData day) => inner.removeDay(date, day);
}
