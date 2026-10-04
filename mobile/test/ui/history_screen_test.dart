import 'package:daily_grind/app/app_services.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

/// Today in the harness is Saturday 3 Oct 2026.
DayData day(
  String date, {
  bool done = false,
  String notes = '',
  String weight = '',
  String session = 'push',
  String? target,
  List<WorkoutItem>? main,
}) =>
    DayData(
      date: date,
      sessionType: session,
      main: main ?? [WorkoutItem(id: 'i-$date', text: 'Bench', target: target, done: done)],
      mainNotes: notes,
      weight: weight,
    );

Future<void> seedTemplates(AppServices s) =>
    s.templateRepo.writeTemplates({'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]), 'push': const TemplateData(label: 'Push day', main: [TemplateRow(id: 'p', text: 'Bench')])});

Future<Harness> openHistory(WidgetTester tester, Future<void> Function(AppServices) seed) async {
  final h = await pumpDashboard(tester, seed: (s) async {
    await seedTemplates(s);
    await seed(s);
  });
  await tester.tap(find.byTooltip('History'));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  uiTest('with nothing logged, says so and shows zeros', (tester) async {
    await openHistory(tester, (s) async {});
    expect(find.text('Workout History'), findsOneWidget);
    expect(find.text('No workout history yet. Start tracking!'), findsOneWidget);
    expect(find.text('0'), findsNWidgets(3));
    expect(find.text('BODY WEIGHT'), findsNothing);
  });

  uiTest('stat cards: streak through today, total workouts, this week', (tester) async {
    await openHistory(tester, (s) async {
      for (final d in ['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-20']) {
        await s.workoutRepo.saveDay(day(d, done: true));
      }
    });
    expect(find.text('DAY STREAK'), findsOneWidget);
    // streak 3, total 4, this week (since Monday 28 Sep) 3
    expect(find.text('3'), findsNWidgets(2));
    expect(find.text('4'), findsOneWidget);
  });

  uiTest('days are grouped under their week, newest first, with the web app\'s headings and volume', (tester) async {
    await openHistory(tester, (s) async {
      await s.workoutRepo.saveDay(day('2026-10-03', done: true, target: '3x8'));
      await s.workoutRepo.saveDay(day('2026-09-24', done: true, target: '4x10'));
      await s.workoutRepo.saveDay(day('2026-09-10', notes: 'just notes'));
    });
    expect(find.text('THIS WEEK · 3 sets'), findsOneWidget);
    expect(find.text('LAST WEEK · 4 sets'), findsOneWidget, reason: '24 Sep is in the week of 21 Sep');
    expect(find.text('7 SEPT 2026'), findsOneWidget, reason: 'older weeks are named by their Monday');
    expect(find.text('Sat 3 Oct'), findsOneWidget);
    expect(find.text('Thu 24 Sep'), findsNothing, reason: 'September is written "Sept", as the web app does');
    expect(find.text('Thu 24 Sept'), findsOneWidget);
    final order = ['Sat 3 Oct', 'Thu 24 Sept', 'Thu 10 Sept'].map((t) => tester.getTopLeft(find.text(t)).dy).toList();
    expect(order, [...order]..sort());
  });

  uiTest('only days with something in them are listed', (tester) async {
    await openHistory(tester, (s) async {
      await s.workoutRepo.saveDay(day('2026-10-02')); // started but nothing ticked or written
      await s.workoutRepo.saveDay(day('2026-10-01', weight: '80'));
    });
    expect(find.text('Fri 2 Oct'), findsNothing);
    expect(find.text('Thu 1 Oct'), findsOneWidget);
    expect(find.text('80 kg'), findsWidgets, reason: 'on its row and as the latest weight');
  });

  uiTest('a row shows its session name as it appears in the picker, and its progress', (tester) async {
    await openHistory(tester, (s) async {
      await s.workoutRepo.saveDay(day('2026-10-02', done: true));
    });
    expect(find.text('Push day'), findsOneWidget);
    expect(find.text('100%'), findsOneWidget);
  });

  uiTest('a session that no longer exists falls back to its id', (tester) async {
    await openHistory(tester, (s) async {
      await s.workoutRepo.saveDay(day('2026-10-02', done: true, session: 'mystery-session'));
    });
    expect(find.text('Mystery Session'), findsOneWidget);
  });

  group('body weight', () {
    uiTest('one reading shows just the value', (tester) async {
      await openHistory(tester, (s) async => s.workoutRepo.saveDay(day('2026-10-01', weight: '79,5')));
      expect(find.text('BODY WEIGHT'), findsOneWidget);
      expect(find.text('79.5 kg'), findsWidgets);
      expect(find.text('1 Oct'), findsOneWidget);
    });

    uiTest('several readings show the latest, how far it moved, and the range of dates', (tester) async {
      await openHistory(tester, (s) async {
        await s.workoutRepo.saveDay(day('2026-09-20', weight: '81'));
        await s.workoutRepo.saveDay(day('2026-09-27', weight: '80.5'));
        await s.workoutRepo.saveDay(day('2026-10-02', weight: '79.5'));
      });
      expect(find.text('79.5 kg'), findsWidgets);
      expect(find.text('↓ 1.5 kg'), findsOneWidget);
      expect(find.text('3 entries'), findsOneWidget);
      expect(find.text('20 Sept'), findsOneWidget);
      expect(find.text('2 Oct'), findsWidgets);
    });

    uiTest('weights that cannot be read say so instead of drawing nothing', (tester) async {
      await openHistory(tester, (s) async => s.workoutRepo.saveDay(day('2026-10-01', weight: 'abc')));
      expect(find.text('No weight logged yet — add your weight in the daily tracker.'), findsOneWidget);
    });
  });

  uiTest('tapping a day opens it on the day screen', (tester) async {
    final h = await openHistory(tester, (s) async {
      await s.workoutRepo.saveDay(day('2026-09-24', done: true, notes: 'an older day'));
    });
    await tester.tap(find.text('Thu 24 Sept'));
    await tester.pumpAndSettle();
    expect(h.services.tracker.currentDate, '2026-09-24');
    expect(find.text('Thu 24 Sep 2026'), findsOneWidget);
  });

  group('removing a day', () {
    uiTest('swiping asks first; cancelling keeps it', (tester) async {
      final h = await openHistory(tester, (s) async => s.workoutRepo.saveDay(day('2026-10-02', done: true)));
      await tester.drag(find.text('Fri 2 Oct'), const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(find.text('Remove this day from your history?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Fri 2 Oct'), findsOneWidget);
      expect(await h.stored(), contains('2026-10-02'));
    });

    uiTest('confirming removes it, records the deletion for sync, and says so', (tester) async {
      final h = await openHistory(tester, (s) async => s.workoutRepo.saveDay(day('2026-10-02', done: true)));
      await tester.drag(find.text('Fri 2 Oct'), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Remove');

      expect(find.text('Fri 2 Oct'), findsNothing);
      expect(find.text('Day removed from history'), findsOneWidget);
      expect(await h.stored(), isNot(contains('2026-10-02')));
      expect((await h.services.workoutRepo.readSnapshot())!.deletedDays!.keys, contains('2026-10-02'));
    });
  });
}
