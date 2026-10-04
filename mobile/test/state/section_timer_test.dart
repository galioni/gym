import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/sqlite_repositories.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/domain/workout_transitions.dart';
import 'package:daily_grind/state/day_timers.dart';
import 'package:daily_grind/state/section_timer.dart';
import 'package:daily_grind/state/workout_tracker.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

/// The stopwatch measures the wall clock, so the tests drive a fake one together with the fake timers.
void main() {
  group('SectionTimer', () {
    test('counts real time, even if no tick fires (the app was in the background)', () {
      fakeAsync((async) {
        final saves = <int>[];
        final t = SectionTimer(onSave: saves.add, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.start();
        // Jump the clock without running timers, as a suspended app would experience.
        async.elapse(const Duration(minutes: 3));
        expect(t.elapsedMs, 180000);
        t.dispose();
      });
    });

    test('pause keeps the time and saves it; start carries on from there', () {
      fakeAsync((async) {
        final saves = <int>[];
        final t = SectionTimer(onSave: saves.add, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.start();
        async.elapse(const Duration(seconds: 3));
        t.pause();
        expect([t.isRunning, t.elapsedMs, saves], [false, 3000, [3000]]);

        async.elapse(const Duration(seconds: 10));
        expect(t.elapsedMs, 3000, reason: 'paused time does not count');
        t.start();
        async.elapse(const Duration(seconds: 2));
        expect(t.elapsedMs, 5000);
        t.dispose();
      });
    });

    test('a running timer saves its progress every five seconds and keeps running', () {
      fakeAsync((async) {
        final saves = <int>[];
        final t = SectionTimer(onSave: saves.add, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.start();
        async.elapse(const Duration(seconds: 11));
        expect(saves, [5000, 10000]);
        expect(t.isRunning, isTrue);
        expect(t.elapsedMs, 11000);
        t.dispose();
      });
    });

    test('its own saves coming back as the stored value never stop it (the web timer stops here)', () {
      fakeAsync((async) {
        late SectionTimer t;
        t = SectionTimer(
          onSave: (ms) => t.adopt(ms), // the stored value flows back in, as the app does through the tracker
          now: () => async.getClock(DateTime(2026, 10, 3)).now(),
        );
        t.start();
        async.elapse(const Duration(seconds: 11));
        expect(t.isRunning, isTrue);
        expect(t.elapsedMs, 11000);
        t.dispose();
      });
    });

    test('a different stored value (another day, a sync) stops it and is shown', () {
      fakeAsync((async) {
        final t = SectionTimer(onSave: (_) {}, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.start();
        async.elapse(const Duration(seconds: 2));
        t.adopt(90000);
        expect([t.isRunning, t.elapsedMs], [false, 90000]);
        async.elapse(const Duration(seconds: 5));
        expect(t.elapsedMs, 90000);
        t.dispose();
      });
    });

    test('reset stops, zeroes and saves', () {
      fakeAsync((async) {
        final saves = <int>[];
        final t = SectionTimer(onSave: saves.add, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.start();
        async.elapse(const Duration(seconds: 4));
        t.reset();
        expect([t.isRunning, t.elapsedMs, saves], [false, 0, [0]]);
        t.dispose();
      });
    });

    test('saveNow stores progress without stopping, and does nothing when stopped', () {
      fakeAsync((async) {
        final saves = <int>[];
        final t = SectionTimer(onSave: saves.add, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.saveNow();
        expect(saves, isEmpty);
        t.start();
        async.elapse(const Duration(seconds: 2));
        t.saveNow();
        expect([saves, t.isRunning], [[2000], true]);
        t.dispose();
      });
    });

    test('a running timer redraws its widget about five times a second; a stopped one does not', () {
      fakeAsync((async) {
        final t = SectionTimer(onSave: (_) {}, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        var redraws = 0;
        t.addListener(() => redraws++);
        t.start();
        redraws = 0;
        async.elapse(const Duration(seconds: 1));
        expect(redraws, 5);
        t.pause();
        redraws = 0;
        async.elapse(const Duration(seconds: 5));
        expect(redraws, 0);
        t.dispose();
      });
    });

    test('starting twice, pausing when stopped and disposing while running are all harmless', () {
      fakeAsync((async) {
        final saves = <int>[];
        final t = SectionTimer(onSave: saves.add, now: () => async.getClock(DateTime(2026, 10, 3)).now());
        t.pause();
        t.start();
        t.start();
        async.elapse(const Duration(seconds: 1));
        t.dispose();
        async.elapse(const Duration(seconds: 30));
        expect(saves, isEmpty, reason: 'nothing fires after dispose');
      });
    });
  });

  group('DayTimers', () {
    late LocalDatabase db;
    late SqliteWorkoutDataRepository repo;

    setUp(() {
      db = LocalDatabase.inMemory();
      repo = SqliteWorkoutDataRepository(db);
    });
    tearDown(() => db.close());

    DayData day(String date, {int warmup = 0, int main = 0, String session = 'yoga'}) => DayData(
          date: date,
          sessionType: session,
          main: [WorkoutItem(id: 'i-$date', text: 'x')],
          warmupTimerMs: warmup,
          mainTimerMs: main,
        );

    Templates templates() => {
          'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
          'yoga': const TemplateData(main: [TemplateRow(id: 'y', text: 'Flow')]),
          'run': const TemplateData(main: [TemplateRow(id: 'r', text: 'Run')]),
        };

    ({WorkoutTracker tracker, DayTimers timers}) rig(FakeAsync async) {
      final clock = async.getClock(DateTime(2026, 10, 3, 12));
      final tracker = WorkoutTracker(store: repo, templates: templates, now: () => clock.now(), idGen: () => 'g');
      tracker.load();
      async.flushMicrotasks();
      return (tracker: tracker, timers: DayTimers(tracker, now: () => clock.now()));
    }

    test('shows the stored times of the day, and saves a running timer onto that day', () {
      fakeAsync((async) {
        repo.saveDay(day('2026-10-03', warmup: 60000, main: 120000));
        final r = rig(async);
        expect([r.timers.warmup.elapsedMs, r.timers.main.elapsedMs], [60000, 120000]);

        r.timers.main.start();
        async.elapse(const Duration(seconds: 7));
        async.flushMicrotasks();
        expect(r.tracker.currentDay.mainTimerMs, 125000, reason: 'the 5s autosave went onto the day');
        expect(r.timers.main.isRunning, isTrue, reason: 'and did not stop the timer');
        expect(r.timers.runningSection, WorkoutSection.main);

        r.timers.dispose();
        r.tracker.dispose();
        async.flushTimers();
      });
    });

    test('switching day saves the running time on the day it was timing, then shows the new day', () {
      fakeAsync((async) {
        repo.saveDay(day('2026-10-03', main: 1000));
        repo.saveDay(day('2026-10-02', main: 500));
        final r = rig(async);
        r.timers.main.start();
        async.elapse(const Duration(seconds: 3));

        r.tracker.setCurrentDate('2026-10-02');
        async.flushMicrotasks();

        expect(r.tracker.allData['2026-10-03']!.mainTimerMs, 4000, reason: 'the 3s run was added to the day it belongs to');
        expect([r.timers.main.isRunning, r.timers.main.elapsedMs], [false, 500]);
        expect(r.timers.runningSection, isNull);

        r.timers.dispose();
        r.tracker.dispose();
        async.flushTimers();
      });
    });

    test('a refilled session restarts both timers, even one that has not saved yet', () {
      fakeAsync((async) {
        repo.saveDay(day('2026-10-03'));
        final r = rig(async);
        r.timers.warmup.start();
        async.elapse(const Duration(seconds: 2));

        r.tracker.changeSessionType('run');
        async.flushMicrotasks();

        expect([r.timers.warmup.isRunning, r.timers.warmup.elapsedMs], [false, 0]);
        expect(r.tracker.currentDay.warmupTimerMs, 0);

        r.timers.dispose();
        r.tracker.dispose();
        async.flushTimers();
      });
    });

    test('data arriving from a sync that changes a stored time is shown', () {
      fakeAsync((async) {
        repo.saveDay(day('2026-10-03', main: 1000));
        final r = rig(async);
        repo.saveDay(day('2026-10-03', main: 50000));
        r.tracker.reload();
        async.flushMicrotasks();
        expect(r.timers.main.elapsedMs, 50000);

        r.timers.dispose();
        r.tracker.dispose();
        async.flushTimers();
      });
    });

    test('going to the background stores progress without stopping', () {
      fakeAsync((async) {
        repo.saveDay(day('2026-10-03'));
        final r = rig(async);
        r.timers.main.start();
        async.elapse(const Duration(seconds: 2));
        r.timers.saveAll();
        async.flushMicrotasks();
        expect(r.tracker.currentDay.mainTimerMs, 2000);
        expect(r.timers.main.isRunning, isTrue);

        r.timers.dispose();
        r.tracker.dispose();
        async.flushTimers();
      });
    });

    test('disposing detaches from the tracker', () {
      fakeAsync((async) {
        final r = rig(async);
        r.timers.dispose();
        expect(r.tracker.beforeDayChange, isNull);
        r.tracker.setCurrentDate('2026-10-01'); // must not touch the disposed timers
        r.tracker.dispose();
        async.flushTimers();
      });
    });
  });
}
