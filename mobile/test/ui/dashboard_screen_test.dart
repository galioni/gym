import 'package:daily_grind/app/app_events.dart';
import 'package:daily_grind/app/app_services.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:daily_grind/ui/dashboard/notes_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

const today = '2026-10-03';

DayData day(String date, {String session = 'yoga', String notes = '', String weight = '', bool done = false, List<WorkoutItem>? main}) => DayData(
      date: date,
      sessionType: session,
      main: main ?? [WorkoutItem(id: 'i-$date', text: 'Sun salutation', target: '5 rounds', done: done)],
      warmup: [WorkoutItem(id: 'w-$date', text: 'Cat-cow')],
      mainNotes: notes,
      weight: weight,
    );

Future<void> seedYoga(AppServices services) async {
  await services.templateRepo.writeTemplates({
    'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
    'yoga': const TemplateData(
      label: 'Yoga flow',
      focus: 'Mobility and calm',
      warmup: [TemplateRow(id: 'w', text: 'Cat-cow')],
      main: [TemplateRow(id: 'm', text: 'Sun salutation', target: '5 rounds')],
    ),
    'run': const TemplateData(label: 'Easy run', main: [TemplateRow(id: 'r', text: 'Run 5k')]),
  });
}

Future<void> scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void main() {
  group('what it shows', () {
    uiTest('today, the session, and its exercises from the template', (tester) async {
      await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
      expect(find.text('Yoga flow'), findsWidgets);
      expect(find.text('Mobility and calm'), findsOneWidget);
      expect(find.text('Sun salutation'), findsOneWidget);
      expect(find.text('5 rounds'), findsOneWidget);
      expect(find.text('Cat-cow'), findsOneWidget);
      expect(find.text('0%'), findsOneWidget);
    });

    uiTest('an empty account starts on the built-in default session, ready to use', (tester) async {
      await pumpDashboard(tester);
      expect(find.text('Tennis day (warm-up + strength mini)'), findsWidgets);
      expect(find.text('2-3 min brisk walk / light jog'), findsOneWidget);
    });

    uiTest('a session with nothing in it says so', (tester) async {
      await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today, main: const []));
      });
      expect(find.text('No exercises yet'), findsOneWidget);
    });

    uiTest('wide screens put the two lists side by side, narrow ones stack them', (tester) async {
      Future<void> seed(AppServices s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      }

      await pumpDashboard(tester, size: const Size(1000, 900), seed: seed);
      final wideWarm = tester.getTopLeft(find.text('Warm-up').first);
      final wideMain = tester.getTopLeft(find.text('Main Session').first);
      expect(wideMain.dx, greaterThan(wideWarm.dx + 100));
      expect((wideMain.dy - wideWarm.dy).abs(), lessThan(5));

      await pumpDashboard(tester, size: const Size(420, 900), seed: seed);
      final narrowWarm = tester.getTopLeft(find.text('Warm-up').first);
      final narrowMain = tester.getTopLeft(find.text('Main Session').first);
      expect((narrowMain.dx - narrowWarm.dx).abs(), lessThan(5));
      expect(narrowMain.dy, greaterThan(narrowWarm.dy));
    });
  });

  group('doing the workout', () {
    uiTest('ticking an exercise updates progress at once and is stored', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.tap(find.text('Sun salutation'));
      await tester.pump();
      expect(find.text('50%'), findsOneWidget, reason: '1 of 2 done');
      await tester.pump(const Duration(milliseconds: 400));

      expect((await h.stored())[today]!.main.single.done, isTrue);
      await tester.tap(find.text('Sun salutation'));
      await tester.pump();
      expect(find.text('0%'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
    });

    uiTest('completing everything shows 100%', (tester) async {
      await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.tap(find.text('Cat-cow'));
      await tester.tap(find.text('Sun salutation'));
      await tester.pump();
      expect(find.text('100%'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
    });

    uiTest('swiping an exercise away asks first; cancelling keeps it', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.drag(find.text('Sun salutation'), const Offset(-400, 0));
      await tester.pumpAndSettle();
      expect(find.text('Remove exercise?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Sun salutation'), findsOneWidget);
      expect((await h.stored())[today]!.main, hasLength(1));
    });

    uiTest('confirming removes it, saves, and says so', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.drag(find.text('Sun salutation'), const Offset(-400, 0));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Delete');

      expect(find.text('Sun salutation'), findsNothing);
      expect(find.text('Exercise removed'), findsOneWidget);
      expect((await h.stored())[today]!.main, isEmpty);
      expect(find.text('No exercises yet'), findsOneWidget);
    });

    uiTest('changing the session refills the lists from its template', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today, done: true));
      });
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Easy run').last);
      await tester.pumpAndSettle();

      expect(find.text('Run 5k'), findsOneWidget);
      expect(find.text('Sun salutation'), findsNothing);
      final saved = (await h.stored())[today]!;
      expect([saved.sessionType, saved.main.single.text, saved.main.single.done], ['run', 'Run 5k', false]);
    });

    uiTest('typing notes saves after a pause, not on every key', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      final notes = find.byType(NotesField).first;
      await tester.enterText(find.descendant(of: notes, matching: find.byType(TextField)), 'felt strong');
      await tester.pump(const Duration(milliseconds: 200));
      expect((await h.stored())[today]!.warmupNotes, isEmpty, reason: 'still typing');
      await tester.pump(const Duration(milliseconds: 400));
      expect((await h.stored())[today]!.warmupNotes, 'felt strong');
    });

    uiTest('weight: a bad value shows the web app\'s message and is not stored; a good one is', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      final weight = find.widgetWithText(TextField, 'Weight (kg)');
      await scrollTo(tester, weight);
      await tester.enterText(weight, '700');
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Value seems too high (max 500 kg)'), findsOneWidget);
      expect((await h.stored())[today]!.weight, isEmpty);

      await tester.enterText(weight, '79.5');
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Value seems too high (max 500 kg)'), findsNothing);
      expect((await h.stored())[today]!.weight, '79.5');

      await tester.enterText(weight, '79,5');
      await tester.pump(const Duration(seconds: 1));
      expect((await h.stored())[today]!.weight, '79,5', reason: 'a decimal comma is kept as typed, like the web app');
    });
  });

  group('moving between days', () {
    uiTest('previous and next day, with their own data, and back to today', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today, notes: 'today'));
        await s.workoutRepo.saveDay(day('2026-10-02', session: 'run', main: [const WorkoutItem(id: 'r', text: 'Run 5k')]));
      });
      await tester.tap(find.byTooltip('Previous day'));
      await tester.pumpAndSettle();
      expect(find.text('Fri 2 Oct 2026'), findsOneWidget);
      expect(find.text('Run 5k'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget, reason: 'the way back is offered');

      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
      expect(find.text('Sun salutation'), findsOneWidget);

      await tester.tap(find.byTooltip('Next day'));
      await tester.pumpAndSettle();
      expect(find.text('Sun 4 Oct 2026'), findsOneWidget);
      expect(h.services.tracker.currentDate, '2026-10-04');
    });

    uiTest('a day nobody has touched is not stored just by looking at it', (tester) async {
      final h = await pumpDashboard(tester, seed: seedYoga);
      await tester.tap(find.byTooltip('Previous day'));
      await tester.pumpAndSettle();
      expect(await h.stored(), isEmpty);
    });
  });

  group('timers', () {
    uiTest('start, watch it count, pause: the time is kept and saved on the day', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      expect(find.text('00:00'), findsNWidgets(2));
      await tester.tap(find.byTooltip('Start timer').last);
      await tester.pump();
      await h.advance(tester, const Duration(seconds: 3));
      expect(find.text('00:03'), findsOneWidget);
      expect(find.text('Main'), findsOneWidget, reason: 'the footer points at the running timer');

      await tester.tap(find.byTooltip('Pause timer'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect((await h.stored())[today]!.mainTimerMs, 3000);
      expect(find.text('Main'), findsNothing);

      await h.advance(tester, const Duration(seconds: 10));
      expect(find.text('00:03'), findsOneWidget, reason: 'paused time does not count');
    });

    uiTest('a running timer keeps going after the first autosave (the web timer stops there)', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.tap(find.byTooltip('Start timer').first);
      await tester.pump();
      for (var i = 0; i < 12; i++) {
        await h.advance(tester, const Duration(seconds: 1));
      }
      expect(find.byTooltip('Pause timer'), findsOneWidget, reason: 'still running after 12s, past two autosaves');
      expect(find.text('00:12'), findsOneWidget);
      expect((await h.stored())[today]!.warmupTimerMs, greaterThanOrEqualTo(10000));
    });

    uiTest('reset zeroes it', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today).copyWith(mainTimerMs: 90000));
      });
      expect(find.text('01:30'), findsOneWidget);
      await tester.tap(find.byTooltip('Reset timer').last);
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('01:30'), findsNothing);
      expect((await h.stored())[today]!.mainTimerMs, 0);
    });

    uiTest('switching day while it runs saves the time on the day it was timing', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.tap(find.byTooltip('Start timer').last);
      await tester.pump();
      await h.advance(tester, const Duration(seconds: 4));
      await tester.tap(find.byTooltip('Previous day'));
      await tester.pumpAndSettle();
      expect((await h.stored())[today]!.mainTimerMs, 4000);
      expect(find.byTooltip('Pause timer'), findsNothing);
    });
  });

  group('plans', () {
    uiTest('the active plan shows its week, and tapping a session starts it', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.plansRepo.writePlans(const [Plan(id: 'p', label: 'Plan A', sessionIds: ['yoga', 'run'], schedule: {'4': 'run', '5': 'yoga'})]);
        await s.plansRepo.writeActivePlanId('p');
        await s.workoutRepo.saveDay(day(today));
      });
      expect(find.text('PLAN A'), findsOneWidget);
      expect(find.text('Sa'), findsOneWidget);
      expect(find.text('Fr'), findsOneWidget);

      await tester.tap(find.text('Easy run').first);
      await tester.pumpAndSettle();
      expect((await h.stored())[today]!.sessionType, 'run');
    });

    uiTest('only the plan\'s sessions are offered in the picker', (tester) async {
      await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.plansRepo.writePlans(const [Plan(id: 'p', label: 'Plan A', sessionIds: ['yoga'])]);
        await s.plansRepo.writeActivePlanId('p');
        await s.workoutRepo.saveDay(day(today));
      });
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      expect(find.text('Easy run'), findsNothing);
      expect(find.text('Yoga flow'), findsWidgets);
    });

    uiTest('a fresh day today starts with the session the plan schedules for this weekday', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        // 2026-10-03 is a Saturday: index 5.
        await s.plansRepo.writePlans(const [Plan(id: 'p', label: 'Plan A', sessionIds: ['yoga', 'run'], schedule: {'5': 'run'})]);
        await s.plansRepo.writeActivePlanId('p');
      });
      expect(find.text('Run 5k'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
      expect((await h.stored())[today]!.sessionType, 'run');
    });
  });

  group('the menu', () {
    uiTest('copy yesterday\'s notes and weight', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
        await s.workoutRepo.saveDay(day('2026-10-02', notes: 'felt strong', weight: '79.5'));
      });
      await tester.tap(find.byTooltip('Menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text("Copy yesterday's notes & weight"));
      await tester.pumpAndSettle();
      expect(find.text('Previous notes and weight duplicated'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
      final saved = (await h.stored())[today]!;
      expect([saved.mainNotes, saved.weight], ['felt strong', '79.5']);
    });

    uiTest('copy with no yesterday says there is nothing to copy', (tester) async {
      await pumpDashboard(tester, seed: seedYoga);
      await tester.tap(find.byTooltip('Menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text("Copy yesterday's notes & weight"));
      await tester.pumpAndSettle();
      expect(find.text('Nothing to duplicate'), findsOneWidget);
    });

    uiTest('clear day asks, keeps the session, and cancelling does nothing', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today, notes: 'keep?', done: true));
      });
      await tester.tap(find.byTooltip('Clear day'));
      await tester.pumpAndSettle();
      expect(find.text('Clear all day data?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect((await h.stored())[today]!.mainNotes, 'keep?');

      await tester.tap(find.byTooltip('Clear day'));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Clear Day');
      expect(find.text('Day cleared'), findsOneWidget);
      final saved = (await h.stored())[today]!;
      expect([saved.sessionType, saved.mainNotes, saved.main.single.done], ['yoga', '', false]);
    });
  });

  group('sync and connection', () {
    uiTest('the app bar shows the sync state, and it says "Synced" once the first sync is done', (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      expect(h.services.sync.settings.lastSyncedAt, isNotNull);
      expect(find.bySemanticsLabel(RegExp('^Synced')), findsOneWidget);
    });

    uiTest('offline: a banner, an offline state, and no sync attempts', (tester) async {
      final h = await pumpDashboard(tester, online: false, seed: (s) async {
        await seedYoga(s);
        await s.workoutRepo.saveDay(day(today));
      });
      expect(find.textContaining("You're offline"), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('^Offline')), findsOneWidget);
      expect(h.cloud.calls, isEmpty);

      h.net.set(true);
      await tester.pumpAndSettle();
      expect(find.textContaining("You're offline"), findsNothing);
      expect(h.cloud.calls, isNotEmpty);
    });

    uiTest('a conflict found by a sync is announced with a way to review it', (tester) async {
      final h = await pumpDashboard(tester, seed: seedYoga);
      h.services.autoSync.onConflicts([
        const SyncConflict(entity: SyncEntity.workoutData, localUpdatedAt: 'a', cloudUpdatedAt: 'b', previewPaths: ['2026-10-01.mainNotes']),
      ]);
      await tester.pumpAndSettle();
      expect(find.text('Sync needs your attention'), findsOneWidget);
      expect(find.text('Review'), findsOneWidget);
    });

    uiTest('a full account is told so', (tester) async {
      final h = await pumpDashboard(tester, seed: seedYoga);
      h.services.autoSync.onStorageLimit('Your account has reached its cloud storage limit for workout days.');
      await tester.pumpAndSettle();
      expect(find.text('Cloud storage limit reached'), findsOneWidget);
      expect(find.textContaining('workout days'), findsOneWidget);
    });

    uiTest("another account's data: asks, and switching wipes the device and carries on", (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seedYoga(s);
        s.owner.check('someone-else');
        await s.workoutRepo.saveDay(day(today, notes: 'their data'));
      });
      expect(find.text("Another account's data is on this device"), findsOneWidget);
      expect(h.cloud.tables.values.every((t) => t.isEmpty), isTrue, reason: 'nothing of theirs was uploaded');

      await confirmDangerous(tester, 'Switch to this account');
      expect(find.text('their data'), findsNothing);
      expect(await h.stored(), isEmpty);
    });

    uiTest("another account's data: signing out instead leaves it alone", (tester) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        s.owner.check('someone-else');
        await s.workoutRepo.saveDay(day(today, notes: 'their data'));
      });
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(h.authRepo.calls, contains('signOut'));
      expect((await h.stored())[today]!.mainNotes, 'their data');
    });
  });

  uiTest('a data event that nobody handles does not crash the screen', (tester) async {
    final h = await pumpDashboard(tester, seed: seedYoga);
    h.services.autoSync.onOwnerMismatch();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(const OwnerMismatch(), isA<AppEvent>());
  });
}
