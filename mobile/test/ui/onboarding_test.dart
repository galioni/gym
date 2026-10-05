import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/plan_generation.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/sync_device.dart' show mkDay;

const _generated = GeneratedPlan(
  templates: {
    'push': TemplateData(label: 'Push', source: 'ai', main: [TemplateRow(id: 'p1', text: 'Bench press')]),
  },
  split: 'Push / Pull / Legs',
  schedule: ['push', 'pull', 'legs'],
  progression: 'Add 2.5 kg when all sets are done.',
  notes: 'Deload every fourth week.',
);

Future<Harness> openWizard(WidgetTester tester, {Future<void> Function(dynamic s)? seed}) async {
  final h = await pumpDashboard(tester, size: const Size(420, 3200), throughGate: true, seed: seed);
  return h;
}

Future<void> answerEverything(WidgetTester tester, {bool withFocus = false}) async {
  await tester.tap(find.text('Build muscle'));
  await tester.tap(find.text('Intermediate'));
  await tester.tap(find.text('4'));
  await tester.tap(find.text('Home gym'));
  await tester.tap(find.text('60 min'));
  if (withFocus) {
    await tester.tap(find.text('Chest'));
    await tester.tap(find.text('Legs'));
  }
  await tester.pump();
}

FilledButton generateButton(WidgetTester tester) => tester.widget<FilledButton>(find.byType(FilledButton).last);

void main() {
  group('first run', () {
    uiTest('a new account is asked to build a plan, and cannot generate until every question is answered', (tester) async {
      await openWizard(tester);
      expect(find.text('Build your plan'), findsOneWidget);
      expect(find.text("Skip — I'll set up my plan manually"), findsOneWidget);
      expect(find.text('Generate my plan'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Generate my plan')).onPressed, isNull);

      await tester.tap(find.text('Build muscle'));
      await tester.tap(find.text('Intermediate'));
      await tester.tap(find.text('4'));
      await tester.tap(find.text('Home gym'));
      await tester.pump();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Generate my plan')).onPressed, isNull, reason: 'duration is missing');

      await tester.tap(find.text('60 min'));
      await tester.pump();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Generate my plan')).onPressed, isNotNull);
    });

    uiTest('generating sends the answers, stores the plan and what it came from, and opens the day screen', (tester) async {
      final h = await openWizard(tester);
      h.api.planToReturn = _generated;
      await answerEverything(tester, withFocus: true);
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();

      expect(h.api.generated, hasLength(1));
      expect(h.api.generated.single.toJson(), {
        'goal': 'muscle',
        'experience': 'intermediate',
        'daysPerWeek': 4,
        'equipment': 'home_gym',
        'duration': '60',
        'bodyFocus': ['chest', 'legs'],
      });
      expect(find.text('Build your plan'), findsNothing);
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
      expect(h.services.onboarded.value, isTrue);
      expect((await h.services.templateRepo.readSnapshot())!.data.keys, contains('push'));
      expect(h.services.workspace.planParams!['goal'], 'muscle');
      expect(h.services.workspace.planMeta!['split'], 'Push / Pull / Legs');
    });

    uiTest('while it works the button says so and cannot be pressed again', (tester) async {
      final h = await openWizard(tester);
      final release = Future<void>.delayed(const Duration(seconds: 10));
      h.api
        ..planToReturn = _generated
        ..hold = release;
      await answerEverything(tester);
      await tester.tap(find.text('Generate my plan'));
      await tester.pump();
      expect(find.text('Analysing your goals...'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 2300));
      expect(find.text('Selecting exercises...'), findsOneWidget);
      expect(generateButton(tester).onPressed, isNull);
      expect(find.text('Skip — I\'ll set up my plan manually').hitTestable(), findsOneWidget);

      await tester.pump(const Duration(seconds: 10));
      await tester.pumpAndSettle();
      expect(h.api.generated, hasLength(1));
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
    });

    uiTest('the Free plan limit is explained, with when to retry, and the answers are kept', (tester) async {
      final h = await openWizard(tester);
      h.api.failGenerate = const ApiException(429, 'Free plan includes 1 AI plan per month.', retryAfterSeconds: 7200, plan: 'free');
      await answerEverything(tester);
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();

      expect(find.text('Free plan includes 1 AI plan per month. Try again in 2 hours.'), findsOneWidget);
      expect(find.textContaining('Pro lifts this limit'), findsOneWidget);
      expect(find.text('Build your plan'), findsOneWidget);
      expect(generateButton(tester).onPressed, isNotNull, reason: 'it can be retried');
      expect(h.services.onboarded.value, isFalse);
    });

    uiTest('a server error is reported without offering Pro', (tester) async {
      final h = await openWizard(tester);
      h.api.failGenerate = const ApiException(500, 'boom');
      await answerEverything(tester);
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();
      expect(find.text('Plan generation failed due to a server error. Please try again in a moment.'), findsOneWidget);
      expect(find.textContaining('Pro lifts this limit'), findsNothing);
    });

    uiTest('no connection is reported, and trying again works', (tester) async {
      final h = await openWizard(tester);
      h.api.failGenerate = const ApiException.network('Could not reach the server. Check your connection and try again.');
      await answerEverything(tester);
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();
      expect(find.text('Could not reach the server. Check your connection and try again.'), findsOneWidget);

      h.api
        ..failGenerate = null
        ..planToReturn = _generated;
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();
      expect(find.text('Could not reach the server. Check your connection and try again.'), findsNothing);
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
    });

    uiTest('skipping goes to the day screen with the built-in sessions and does not ask again', (tester) async {
      final h = await openWizard(tester);
      await tester.tap(find.text("Skip — I'll set up my plan manually"));
      await tester.pumpAndSettle();
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
      expect(h.api.generated, isEmpty);
      expect(h.services.onboarded.value, isTrue);
      expect(h.services.database.readDoc('onboarded'), isTrue, reason: 'remembered on this device');
    });

    uiTest('an account that already has data is not asked', (tester) async {
      await openWizard(tester, seed: (s) => s.workoutRepo.saveDay(mkDay('2026-10-03', 'notes')));
      expect(find.text('Build your plan'), findsNothing);
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
    });

    uiTest('data arriving from the cloud while the wizard is open dismisses it', (tester) async {
      final h = await openWizard(tester);
      expect(find.text('Build your plan'), findsOneWidget);

      await h.services.workoutRepo.saveDay(mkDay('2026-10-02', 'synced from another device'));
      await h.services.reloadFromStorage();
      await tester.pumpAndSettle();
      expect(find.text('Build your plan'), findsNothing);
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
    });
  });

  group('AI plan in Settings', () {
    Future<Harness> signedInWithPlan(WidgetTester tester) async {
      final h = await openWizard(tester);
      h.api.planToReturn = _generated;
      await answerEverything(tester, withFocus: true);
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();
      await h.openSettings(tester);
      return h;
    }

    uiTest('shows what the plan was generated from', (tester) async {
      await signedInWithPlan(tester);
      expect(find.text('AI Plan'), findsOneWidget);
      expect(find.text('Push / Pull / Legs'), findsOneWidget);
      expect(find.text('Add 2.5 kg when all sets are done.'), findsOneWidget);
      expect(find.text('Deload every fourth week.'), findsOneWidget);
      expect(find.text('Build muscle · Intermediate · 4 days/week · Home gym · 60 min · Chest · Legs'), findsOneWidget);
      expect(find.text('Regenerate plan'), findsOneWidget);
    });

    uiTest('without a generated plan it offers to make one', (tester) async {
      final h = await pumpDashboard(tester, size: const Size(420, 3200), throughGate: true);
      await tester.tap(find.text("Skip — I'll set up my plan manually"));
      await tester.pumpAndSettle();
      await h.openSettings(tester);
      expect(find.text('Generate a plan'), findsOneWidget);
      expect(find.text('Regenerate plan'), findsNothing);
    });

    uiTest('regenerating asks first; cancelling changes nothing', (tester) async {
      final h = await signedInWithPlan(tester);
      await tester.tap(find.text('Regenerate plan'));
      await tester.pumpAndSettle();
      expect(find.text('Replace all session templates?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Settings'), findsOneWidget);
      expect(h.services.onboarded.value, isTrue);
    });

    uiTest('regenerating opens the wizard with the earlier answers filled in; cancelling keeps the plan', (tester) async {
      final h = await signedInWithPlan(tester);
      await tester.tap(find.text('Regenerate plan'));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Continue');

      expect(find.text('Rebuild your plan'), findsOneWidget);
      expect(find.text('Settings'), findsNothing, reason: 'Settings is closed behind the wizard');
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Generate my plan')).onPressed, isNotNull, reason: 'answers are prefilled');
      final chest = tester.widget<FilterChip>(find.widgetWithText(FilterChip, 'Chest'));
      expect(chest.selected, isTrue);

      await tester.tap(find.text('Cancel — keep my current plan'));
      await tester.pumpAndSettle();
      expect(find.text('Sat 3 Oct 2026'), findsOneWidget);
      expect(h.api.generated, hasLength(1), reason: 'nothing was regenerated');
      expect((await h.services.templateRepo.readSnapshot())!.data.keys, contains('push'));
    });

    uiTest('a rebuild replaces the plan and its description, and is not dismissed by synced data', (tester) async {
      final h = await signedInWithPlan(tester);
      await tester.tap(find.text('Regenerate plan'));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Continue');

      await h.services.reloadFromStorage();
      await tester.pumpAndSettle();
      expect(find.text('Rebuild your plan'), findsOneWidget, reason: 'data arriving must not close a rebuild');

      h.api.planToReturn = const GeneratedPlan(
        templates: {'legs': TemplateData(label: 'Legs', source: 'ai', main: [TemplateRow(id: 'l1', text: 'Squat')])},
        split: 'Full body',
        schedule: ['legs'],
        progression: 'Add a rep each week.',
      );
      await tester.tap(find.text('Chest')); // deselect
      await tester.tap(find.text('Generate my plan'));
      await tester.pumpAndSettle();

      expect(h.api.generated.last.toJson()['bodyFocus'], ['legs']);
      expect(h.services.workspace.planMeta!['split'], 'Full body');
      expect(h.services.workspace.planMeta!.containsKey('notes'), isFalse, reason: 'the old notes do not linger');
      expect((await h.services.templateRepo.readSnapshot())!.data.keys, contains('legs'));
    });
  });

  group('AI model', () {
    uiTest('is not offered when only one model is available', (tester) async {
      final h = await pumpDashboard(tester, size: const Size(420, 3200), throughGate: true);
      await tester.tap(find.text("Skip — I'll set up my plan manually"));
      await tester.pumpAndSettle();
      await h.openSettings(tester);
      expect(find.text('AI MODEL'), findsNothing);
    });

    uiTest('lists the available models and switches', (tester) async {
      late Harness h;
      h = await pumpDashboard(tester, size: const Size(420, 3200), throughGate: true, seed: (s) async {
        await s.workoutRepo.saveDay(mkDay('2026-10-03', 'x'));
      });
      h.api.providers = ['google', 'anthropic', 'openai'];
      await h.services.aiSettings.load();
      await h.openSettings(tester);

      expect(find.text('AI MODEL'), findsOneWidget);
      expect(find.widgetWithText(ChoiceChip, 'Gemini'), findsOneWidget);
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Gemini')).selected, isTrue);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Claude'));
      await tester.pumpAndSettle();
      expect(h.api.provider, 'anthropic');
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Claude')).selected, isTrue);
    });

    uiTest('a model that needs Pro is refused, the choice goes back, and the reason is shown', (tester) async {
      final h = await pumpDashboard(tester, size: const Size(420, 3200), throughGate: true, seed: (s) async {
        await s.workoutRepo.saveDay(mkDay('2026-10-03', 'x'));
      });
      h.api
        ..providers = ['google', 'anthropic']
        ..failSetProvider = const ApiException(402, 'Upgrade required');
      await h.services.aiSettings.load();
      await h.openSettings(tester);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Claude'));
      await tester.pumpAndSettle();
      expect(find.text('Claude and ChatGPT are included with Pro.'), findsOneWidget);
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Gemini')).selected, isTrue);
      expect(h.api.provider, 'google');
    });
  });
}
