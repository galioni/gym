import 'dart:async';

import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/subscription.dart';
import 'package:daily_grind/data/postgres_repositories.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/state/theme_controller.dart';
import 'package:daily_grind/sync/sync_allowance.dart';
import 'package:daily_grind/sync/sync_errors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/sync_device.dart' show mkDay;

const today = '2026-10-03';

Future<void> seed(dynamic s) async {
  await s.templateRepo.writeTemplates({
    'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
  });
  await s.workoutRepo.saveDay(mkDay(today, 'local notes'));
}

Future<void> scrollToText(WidgetTester tester, String text) async {
  await tester.scrollUntilVisible(find.text(text), 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void main() {
  group('the page', () {
    uiTest('opens from the sync indicator and shows account, plan and sync', (tester) async {
      final h = await pumpDashboard(tester, seed: seed, subscription: const SubscriptionInfo(plan: 'free', status: 'inactive'));
      await h.openSettings(tester);
      expect(find.text('Settings'), findsOneWidget);
      expect(find.text('Account'), findsOneWidget);
      expect(find.text('Ada'), findsOneWidget);
      expect(find.text('Subscription'), findsOneWidget);
      expect(find.text('Sync Settings'), findsOneWidget);
      expect(find.text('Your data syncs automatically'), findsOneWidget);
      expect(find.textContaining('Signed in as a@b.co'), findsOneWidget);
    });

    uiTest('the back arrow returns to the day', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
    });

    uiTest('sign out', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Sign out'));
      await tester.pumpAndSettle();
      expect(h.authRepo.calls, contains('signOut'));
    });
  });

  group('appearance', () {
    uiTest('offers light, dark and system, starts on light, and the choice is applied and kept', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      expect(find.text('Appearance'), findsOneWidget);
      expect(tester.widget<SegmentedButton<ThemePreference>>(find.byType(SegmentedButton<ThemePreference>)).selected, {ThemePreference.light});

      await tester.tap(find.text('Dark'));
      await tester.pumpAndSettle();
      expect(h.services.theme.preference, ThemePreference.dark);
      expect(tester.widget<SegmentedButton<ThemePreference>>(find.byType(SegmentedButton<ThemePreference>)).selected, {ThemePreference.dark});

      await tester.tap(find.text('System'));
      await tester.pumpAndSettle();
      expect(h.services.theme.mode, ThemeMode.system);
    });
  });

  group('subscription', () {
    uiTest('Pro: shows the plan, renewal date and what happens when it ends', (tester) async {
      final h = await pumpDashboard(
        tester,
        seed: seed,
        subscription: const SubscriptionInfo(plan: 'pro', status: 'active', currentPeriodEnd: '2026-11-01T12:00:00.000Z'),
      );
      await h.openSettings(tester);
      expect(find.text('Pro'), findsOneWidget);
      expect(find.text('Renews 1 Nov 2026'), findsOneWidget);
      expect(find.textContaining('If Pro ends, nothing is deleted'), findsOneWidget);
    });

    uiTest('Free: says so and what Free includes', (tester) async {
      final h = await pumpDashboard(tester, seed: seed, subscription: const SubscriptionInfo(plan: 'free', status: 'inactive'));
      await h.openSettings(tester);
      expect(find.textContaining('free plan'), findsOneWidget);
      expect(find.textContaining('Free includes 1 AI-generated plan per day'), findsOneWidget);
    });

    uiTest('a failed lookup says the status could not be loaded, rather than claiming Free', (tester) async {
      final h = await pumpDashboard(tester, seed: seed, subscription: const ApiException(500, 'down'));
      await h.openSettings(tester);
      expect(find.textContaining('Could not load subscription status'), findsOneWidget);
    });
  });

  group('sync now', () {
    uiTest('runs a manual sync, says so, takes a safety snapshot and lists it', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      final before = h.services.sync.restorePoints.length; // the first automatic sync had work to do, so it took one

      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();
      expect(find.text('Sync completed.'), findsOneWidget);
      expect(h.services.sync.restorePoints.length, before + 1, reason: 'a manual sync always takes one');
      await scrollToText(tester, 'Safety snapshots');
      expect(find.text('Rollback'), findsWidgets);
    });

    uiTest('is disabled while a sync is running', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Sync now'));
      expect(button.onPressed, isNotNull);
      final gate = Completer<void>();
      h.cloud.hold = gate.future;
      final running = h.services.sync.syncNow();
      await tester.pump();
      expect(find.text('Syncing...'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Syncing...')).onPressed, isNull);
      gate.complete();
      await running;
      await tester.pumpAndSettle();
      expect(find.text('Sync now'), findsOneWidget);
    });

    uiTest('a failure is shown as one, and recorded where the status reads it', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.services.workoutRepo.saveDay(mkDay(today, 'edited, so there is something to send'));
      h.cloud.refuseWrites = const SyncException('db down');
      await h.openSettings(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();
      expect(find.text('Sync failed'), findsOneWidget);
      expect(h.services.sync.settings.lastError, isNotNull);
      expect(find.text('Sync hit a problem. Your data is safe on this device.'), findsOneWidget);
    });

    uiTest('what a sync brought down appears without leaving the page', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      // Another device uploads a day.
      final other = PostgresWorkoutDataRepository(h.cloud, now: () => h.clock.value);
      await other.readSnapshot();
      await other.writeAll({
        today: mkDay(today, 'local notes'),
        '2026-10-02': mkDay('2026-10-02', 'from the other phone'),
      });
      await h.openSettings(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();
      expect(h.services.tracker.allData.keys, contains('2026-10-02'));
    });
  });

  group('the Free plan\'s monthly sync', () {
    const free = SyncAllowanceStatus(enforced: true, isPro: false);

    uiTest('explains the plan, and asks before using the month\'s sync', (tester) async {
      final h = await pumpDashboard(tester, seed: seed, plan: StubPlan(status: free));
      await h.openSettings(tester);
      expect(find.text('Free plan: one sync every 30 days'), findsOneWidget);
      expect(find.textContaining('A sync is available now.'), findsOneWidget);
      expect(find.textContaining('The cloud keeps your last 7 days'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();
      expect(find.text("Use this month's sync?"), findsOneWidget);
      expect(find.textContaining('next sync will be available on 2 Nov 2026'), findsOneWidget);
      await tester.tap(find.text('Not now'));
      await tester.pumpAndSettle();
      expect(h.services.sync.restorePoints, hasLength(1), reason: 'declining syncs nothing');
      final before = h.services.sync.restorePoints.length;
      expect(before, 1, reason: 'the first automatic (download-only) sync took one');

      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Sync now').last);
      await tester.pumpAndSettle();
      expect(h.services.sync.restorePoints.length, before + 1);
    });

    uiTest('once the month\'s sync is used, the button is off and the next date is shown', (tester) async {
      final h = await pumpDashboard(
        tester,
        seed: seed,
        plan: StubPlan(status: const SyncAllowanceStatus(enforced: true, isPro: false, nextAvailableAt: '2026-11-03T12:00:00.000Z')),
      );
      await h.openSettings(tester);
      expect(find.textContaining('Your sync for this period has been used. The next one is available on 3 Nov 2026.'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Sync now')).onPressed, isNull);
    });
  });

  group('conflicts', () {
    /// The same day is edited on this device AND in the cloud since they last agreed: a real conflict.
    Future<Harness> withConflict(WidgetTester tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      final other = PostgresWorkoutDataRepository(h.cloud, now: () => h.clock.value);
      await other.readSnapshot();
      await other.writeAll({today: mkDay(today, 'cloud notes')});
      await h.services.workoutRepo.saveDay(mkDay(today, 'local edit'));
      await h.services.sync.syncNow();
      await tester.pumpAndSettle();
      return h;
    }

    uiTest('a conflict is shown with what differs, and nothing is overwritten', (tester) async {
      final h = await withConflict(tester);
      expect(h.services.sync.conflicts, isNotEmpty);
      await h.openSettings(tester);
      await scrollToText(tester, 'Workout data conflict');
      expect(find.text('Workout data conflict'), findsOneWidget);
      expect(find.text('3 Oct — main notes'), findsOneWidget);
      expect((await h.stored())[today]!.mainNotes, 'local edit');
      expect(find.text('Choose a version for each conflict above.'), findsOneWidget);
    });

    uiTest('"Apply choices" waits for a decision, then keeping the cloud brings its version here', (tester) async {
      final h = await withConflict(tester);
      await h.openSettings(tester);
      await scrollToText(tester, 'Apply choices and sync');
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Apply choices and sync')).onPressed, isNull);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Keep cloud'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Cloud version wins for overlapping changes'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Apply choices and sync'));
      await tester.pumpAndSettle();

      expect(h.services.sync.conflicts, isEmpty);
      expect((await h.stored())[today]!.mainNotes, 'cloud notes');
      expect(find.text('Workout data conflict'), findsNothing);
    });

    uiTest('keeping this device sends its version to the cloud', (tester) async {
      final h = await withConflict(tester);
      await h.openSettings(tester);
      await scrollToText(tester, 'Apply choices and sync');
      await tester.tap(find.widgetWithText(ChoiceChip, 'Keep this device'));
      await tester.pumpAndSettle();
      expect(find.textContaining("This device's version wins"), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Apply choices and sync'));
      await tester.pumpAndSettle();
      expect(h.cloud.tables.values.expand((t) => t.values).any((r) => r['main_notes'] == 'local edit'), isTrue);
      expect((await h.stored())[today]!.mainNotes, 'local edit');
    });

    uiTest('the status chip says a decision is needed', (tester) async {
      final h = await withConflict(tester);
      expect(find.bySemanticsLabel(RegExp('^Needs attention')), findsOneWidget);
      await tester.pump();
      expect(h.services.sync.conflicts.length, 1);
    });
  });

  group('safety snapshots', () {
    uiTest('rolling back restores the data from before the sync', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();

      // After the snapshot was taken, the data changes.
      await h.services.workoutRepo.saveDay(mkDay(today, 'changed afterwards'));
      await tester.scrollUntilVisible(find.text('Rollback').first, 200, scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Rollback').first); // newest first: the snapshot the manual sync just took
      await tester.pumpAndSettle();

      expect(find.text('Rollback complete'), findsOneWidget);
      expect((await h.stored())[today]!.mainNotes, 'local notes');
    });

    uiTest('"Keep newest only" appears once there is more than one, and prunes', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await h.openSettings(tester);
      expect(h.services.sync.restorePoints, hasLength(1), reason: 'the automatic first sync took one');
      expect(find.text('Keep newest only'), findsNothing);

      await tester.tap(find.widgetWithText(FilledButton, 'Sync now'));
      await tester.pumpAndSettle();
      await scrollToText(tester, 'Keep newest only');
      expect(h.services.sync.restorePoints, hasLength(2));

      await tester.tap(find.text('Keep newest only'));
      await tester.pumpAndSettle();
      expect(h.services.sync.restorePoints, hasLength(1));
      expect(find.text('Keep newest only'), findsNothing);
    });
  });

  group('deleting the account', () {
    Future<void> openDelete(WidgetTester tester, Harness h) async {
      await h.openSettings(tester);
      await scrollToText(tester, 'Delete account and all data');
      await tester.tap(find.widgetWithText(FilledButton, 'Delete account and all data'));
      await tester.pumpAndSettle();
    }

    uiTest('asks first, and cancelling changes nothing', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await openDelete(tester, h);
      expect(find.text('Delete account and all data?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(h.api.deleteCalls, 0);
      expect((await h.stored())[today], isNotNull);
      expect(h.authRepo.calls, isNot(contains('signOut')));
    });

    uiTest('confirming clears this device, deletes the account on the server, and signs out', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      await openDelete(tester, h);
      await confirmDangerous(tester, 'Delete everything');
      expect(h.api.deleteCalls, 1);
      expect(await h.stored(), isEmpty);
      expect(h.authRepo.calls, contains('signOut'));
    });

    uiTest('if the server call fails, the device is still cleared and the user is told, then signed out', (tester) async {
      final h = await pumpDashboard(tester, seed: seed);
      h.api.failDelete = const ApiException(500, 'Server deletion failed');
      await openDelete(tester, h);
      await confirmDangerous(tester, 'Delete everything');
      expect(find.text('Server data deletion failed'), findsOneWidget);
      expect(find.textContaining('Local data cleared. Server error: Server deletion failed'), findsOneWidget);
      expect(await h.stored(), isEmpty);
      expect(h.authRepo.calls, contains('signOut'));
    });
  });
}
