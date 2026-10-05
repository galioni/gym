import 'package:daily_grind/app/app_services.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/ui/settings/plans_editor.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

const today = '2026-10-03';

Future<void> seed(AppServices s) async {
  await s.templateRepo.writeTemplates({
    'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')]),
    'yoga': const TemplateData(
      label: 'Yoga flow',
      source: 'user',
      warmup: [TemplateRow(id: 'w1', text: 'Cat-cow', target: '1 min')],
      main: [
        TemplateRow(id: 'm1', text: 'Sun salutation', target: '5 rounds'),
        TemplateRow(id: 'm2', text: 'Warrior II'),
        TemplateRow(id: 'm3', text: 'Child pose'),
      ],
    ),
    'push': const TemplateData(label: 'Push day', source: 'ai', main: [TemplateRow(id: 'p1', text: 'Bench press', target: '3x8')]),
  });
  await s.workoutRepo.saveDay(DayData(
    date: '2026-10-01',
    sessionType: 'push',
    main: const [WorkoutItem(id: 'h1', text: 'Bench press', target: '3x8'), WorkoutItem(id: 'h2', text: 'Bent-over row', target: '4x10')],
  ));
}

/// Opens Settings and picks a session in the template editor.
Future<Harness> openEditor(WidgetTester tester, {String session = 'Yoga flow', Future<void> Function(AppServices)? extra}) async {
  final h = await pumpDashboard(tester, seed: (s) async {
    await seed(s);
    await extra?.call(s);
  });
  await h.openSettings(tester);
  if (session != 'Tennis day (warm-up + strength mini)') await pickSession(tester, session);
  return h;
}

Future<void> pickSession(WidgetTester tester, String label) async {
  final dropdown = find.byKey(const ValueKey('editor-session-tennis-5'), skipOffstage: false);
  final any = dropdown.evaluate().isNotEmpty ? dropdown : find.byWidgetPredicate((w) => w.key is ValueKey && (w.key as ValueKey).value.toString().startsWith('editor-session-'));
  await tester.tap(any.first);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

/// The Save button of the plan form (the template editor has its own Save).
Finder get planSave => find.descendant(of: find.byType(PlansEditor), matching: find.widgetWithText(FilledButton, 'Save'));

Finder rowText(String text) => find.widgetWithText(TextField, text);

Future<void> save(WidgetTester tester) async {
  await tester.ensureVisible(find.widgetWithText(FilledButton, 'Save').first);
  await tester.tap(find.widgetWithText(FilledButton, 'Save').first);
  await tester.pumpAndSettle();
}

void main() {
  group('template editor', () {
    uiTest('shows the exercises of the chosen session and section', (tester) async {
      await openEditor(tester);
      expect(find.text('Session Templates'), findsOneWidget);
      expect(find.text('User Created'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Sun salutation'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Child pose'), findsOneWidget);
      expect(find.widgetWithText(TextField, '5 rounds'), findsOneWidget);

      await tester.tap(find.text('Warm-up'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Cat-cow'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Sun salutation'), findsNothing);
    });

    uiTest('an AI session says so', (tester) async {
      await openEditor(tester, session: 'Push day [AI]');
      expect(find.text('AI Generated'), findsOneWidget);
    });

    uiTest('editing a name and target and saving stores it, tidied', (tester) async {
      final h = await openEditor(tester);
      await tester.enterText(rowText('Warrior II'), '  Warrior III  ');
      await tester.enterText(rowText('5 rounds'), '6 rounds');
      await save(tester);

      expect(find.text('Template saved'), findsOneWidget);
      final stored = (await h.services.templateRepo.readTemplates())!['yoga']!;
      expect(stored.main.map((r) => r.text), ['Sun salutation', 'Warrior III', 'Child pose']);
      expect(stored.main.first.target, '6 rounds');
      expect(find.widgetWithText(TextField, 'Warrior III'), findsOneWidget, reason: 'the screen shows the stored, tidied copy');
    });

    uiTest('an empty exercise name is refused with the web app\'s message and nothing is saved', (tester) async {
      final h = await openEditor(tester);
      await tester.ensureVisible(find.text('Add Exercise'));
      await tester.tap(find.text('Add Exercise'));
      await tester.pumpAndSettle();
      await save(tester);

      expect(find.text('Exercise name is required.'), findsWidgets);
      expect((await h.services.templateRepo.readTemplates())!['yoga']!.main, hasLength(3));
    });

    uiTest('removing a row and saving drops it', (tester) async {
      final h = await openEditor(tester);
      await tester.tap(find.byTooltip('Remove row').at(1));
      await tester.pumpAndSettle();
      await save(tester);
      expect((await h.services.templateRepo.readTemplates())!['yoga']!.main.map((r) => r.text), ['Sun salutation', 'Child pose']);
    });

    uiTest('adding an exercise and saving appends it', (tester) async {
      final h = await openEditor(tester);
      await tester.ensureVisible(find.text('Add Exercise'));
      await tester.tap(find.text('Add Exercise'));
      await tester.pumpAndSettle();
      await tester.enterText(rowText('Exercise').last, 'Pigeon pose');
      await tester.enterText(rowText('Target (e.g. 3x8-12)').last, '2 min');
      await save(tester);
      final main = (await h.services.templateRepo.readTemplates())!['yoga']!.main;
      expect([main.last.text, main.last.target], ['Pigeon pose', '2 min']);
    });

    uiTest('dragging a row reorders the list', (tester) async {
      final h = await openEditor(tester);
      final handle = find.byIcon(Icons.drag_indicator).first;
      final gesture = await tester.startGesture(tester.getCenter(handle));
      await tester.pump(const Duration(milliseconds: 100));
      await gesture.moveBy(const Offset(0, 140));
      await tester.pump(const Duration(milliseconds: 100));
      await gesture.moveBy(const Offset(0, 140));
      await tester.pump(const Duration(milliseconds: 100));
      await gesture.up();
      await tester.pumpAndSettle();
      await save(tester);
      final order = (await h.services.templateRepo.readTemplates())!['yoga']!.main.map((r) => r.text).toList();
      expect(order.first, isNot('Sun salutation'));
      expect(order.toSet(), {'Sun salutation', 'Warrior II', 'Child pose'}, reason: 'nothing lost or duplicated');
    });

    uiTest('typing offers exercises from your history, and choosing one fills the target', (tester) async {
      await openEditor(tester);
      await tester.ensureVisible(find.text('Add Exercise'));
      await tester.tap(find.text('Add Exercise'));
      await tester.pumpAndSettle();
      await tester.enterText(rowText('Exercise').last, 'bent');
      await tester.pumpAndSettle();
      expect(find.text('Bent-over row'), findsOneWidget);
      expect(find.text('4x10'), findsOneWidget);

      await tester.tap(find.text('Bent-over row'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Bent-over row'), findsOneWidget);
      expect(find.widgetWithText(TextField, '4x10'), findsOneWidget);
    });

    uiTest('equipment, description and a video link can be added to a row and are stored', (tester) async {
      final h = await openEditor(tester);
      await tester.ensureVisible(find.text('Add equipment & description').first);
      await tester.tap(find.text('Add equipment & description').first);
      await tester.pumpAndSettle();
      await tester.enterText(rowText('Equipment (e.g. Barbell + squat rack)'), 'Mat');
      await tester.enterText(rowText('How to perform (e.g. Feet shoulder-width apart, descend until thighs parallel)'), 'Reach up, fold forward.');
      await tester.tap(find.text('Add YT Link').first);
      await tester.pumpAndSettle();
      await tester.enterText(rowText('YouTube URL (optional)'), 'https://youtu.be/dQw4w9WgXcQ');
      await save(tester);

      final first = (await h.services.templateRepo.readTemplates())!['yoga']!.main.first;
      expect([first.equipment, first.description, first.videoUrl], ['Mat', 'Reach up, fold forward.', 'https://youtu.be/dQw4w9WgXcQ']);
    });

    uiTest('a row video link that is not YouTube is flagged', (tester) async {
      await openEditor(tester);
      await tester.tap(find.text('Add YT Link').first);
      await tester.pumpAndSettle();
      await tester.enterText(rowText('YouTube URL (optional)'), 'https://example.com/x');
      await tester.pump();
      expect(find.text('Must be a valid YouTube URL'), findsOneWidget);
    });

    uiTest('undo brings back the section as it was before the last save, and says when there is nothing to undo', (tester) async {
      final h = await openEditor(tester);
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(find.text('Nothing to undo'), findsOneWidget);

      await tester.enterText(rowText('Child pose'), 'Something else');
      await save(tester);
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(find.text('Last change undone'), findsOneWidget);
      expect((await h.services.templateRepo.readTemplates())!['yoga']!.main.last.text, 'Child pose');
    });

    uiTest('reset puts the built-in rows back', (tester) async {
      final h = await openEditor(tester, session: 'Tennis day (warm-up + strength mini)');
      await tester.tap(find.text('Reset'));
      await tester.pumpAndSettle();
      expect(find.text('Section reset to defaults'), findsOneWidget);
      expect((await h.services.templateRepo.readTemplates())!['tennis']!.main.map((r) => r.text), contains('Tennis session (60 min)'));
    });

    uiTest('a session video link is checked, and saved when you leave the field', (tester) async {
      final h = await openEditor(tester);
      final field = find.widgetWithText(TextField, 'https://youtube.com/watch?v=...');
      await tester.ensureVisible(field);
      await tester.enterText(field, 'nope');
      await tester.pump();
      expect(find.text('Must be a valid YouTube URL'), findsWidgets);

      await tester.enterText(field, 'https://youtu.be/dQw4w9WgXcQ');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect((await h.services.templateRepo.readTemplates())!['yoga']!.videoUrl, 'https://youtu.be/dQw4w9WgXcQ');
      expect(h.services.workspace.videoUrlFor('yoga'), 'https://youtu.be/dQw4w9WgXcQ');
    });
  });

  group('session types', () {
    uiTest('creating one selects it and tells you', (tester) async {
      final h = await openEditor(tester);
      await tester.tap(find.byTooltip('Add new session type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'e.g. Morning Yoga'), 'Morning Stretch');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();

      expect(find.text('Session type "Morning Stretch" added.'), findsOneWidget);
      expect((await h.services.templateRepo.readTemplates())!.keys, contains('morning-stretch'));
      expect(find.text('No exercises in this section yet.'), findsOneWidget, reason: 'the new, empty session is now selected');
    });

    uiTest('a duplicate name is refused', (tester) async {
      await openEditor(tester);
      await tester.tap(find.byTooltip('Add new session type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'e.g. Morning Yoga'), 'Yoga');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      expect(find.text('Session type "Yoga" already exists.'), findsOneWidget);
    });

    uiTest('renaming changes the label', (tester) async {
      final h = await openEditor(tester);
      await tester.tap(find.byTooltip('Rename session type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Session name'), 'Calm flow');
      await tester.tap(find.byTooltip('Confirm rename'));
      await tester.pumpAndSettle();
      expect(find.text('Session type renamed to "Calm flow".'), findsOneWidget);
      expect((await h.services.templateRepo.readTemplates())!['yoga']!.label, 'Calm flow');
    });

    uiTest('deleting asks first; a session used in your history says so', (tester) async {
      final h = await openEditor(tester, session: 'Push day [AI]');
      await tester.tap(find.byTooltip('Delete session type'));
      await tester.pumpAndSettle();
      expect(find.text('"Push day" is used in your workout history'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect((await h.services.templateRepo.readTemplates())!.keys, contains('push'));

      await tester.tap(find.byTooltip('Delete session type'));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Delete');
      expect((await h.services.templateRepo.readTemplates())!.keys, isNot(contains('push')));
    });

    uiTest('deleting a session that was never used says it is safe', (tester) async {
      await openEditor(tester);
      await tester.tap(find.byTooltip('Delete session type'));
      await tester.pumpAndSettle();
      expect(find.text('Delete "Yoga flow"?'), findsOneWidget);
      expect(find.textContaining('Existing workout days are not affected'), findsOneWidget);
    });
  });

  group('plans', () {
    Future<Harness> openPlans(WidgetTester tester, {Future<void> Function(AppServices)? extra}) async {
      final h = await pumpDashboard(tester, seed: (s) async {
        await seed(s);
        await extra?.call(s);
      });
      await h.openSettings(tester);
      return h;
    }

    uiTest('with none, explains what a plan is', (tester) async {
      await openPlans(tester);
      expect(find.textContaining('No plans yet.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'New plan'), findsOneWidget);
    });

    uiTest('create: needs a name, takes sessions and a weekday schedule, and shows the summary', (tester) async {
      final h = await openPlans(tester);
      await tester.ensureVisible(find.text('New plan'));
      await tester.tap(find.text('New plan'));
      await tester.pumpAndSettle();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Create')).onPressed, isNull);

      await tester.enterText(find.widgetWithText(TextField, 'Plan name (e.g. Strength block)'), 'Calm week');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilterChip, 'Yoga flow'));
      await tester.tap(find.widgetWithText(FilterChip, 'Push day'));
      await tester.pump();
      await tester.tap(find.widgetWithText(FilterChip, 'Assign sessions to days'));
      await tester.pumpAndSettle();

      final monday = find.byKey(const ValueKey('day-0-null-2'));
      await tester.ensureVisible(monday);
      await tester.tap(monday);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Yoga flow').last);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();

      final plan = (await h.services.plansRepo.readPlans()).single;
      expect([plan.label, plan.sessionIds, plan.schedule], ['Calm week', ['yoga', 'push'], {'0': 'yoga'}]);
      expect(find.text('Calm week'), findsOneWidget);
      expect(find.text('Mo: Yoga flow'), findsOneWidget);
    });

    uiTest('without a schedule the summary lists the sessions; set active and deactivate', (tester) async {
      final h = await openPlans(tester, extra: (s) async {
        await s.plansRepo.writePlans(const [Plan(id: 'p1', label: 'Push and yoga', sessionIds: ['push', 'yoga'])]);
      });
      expect(find.text('Push day, Yoga flow'), findsOneWidget);
      expect(find.text('ACTIVE'), findsNothing);

      await tester.tap(find.text('Set active'));
      await tester.pumpAndSettle();
      expect(find.text('ACTIVE'), findsOneWidget);
      expect(await h.services.plansRepo.readActivePlanId(), 'p1');

      await tester.tap(find.text('Deactivate'));
      await tester.pumpAndSettle();
      expect(find.text('ACTIVE'), findsNothing);
      expect(await h.services.plansRepo.readActivePlanId(), isNull);
    });

    uiTest('edit: rename, and dropping a session also drops it from the schedule', (tester) async {
      final h = await openPlans(tester, extra: (s) async {
        await s.plansRepo.writePlans(const [
          Plan(id: 'p1', label: 'Week', sessionIds: ['push', 'yoga'], schedule: {'0': 'push', '2': 'yoga'}),
        ]);
      });
      expect(find.text('Mo: Push day · We: Yoga flow'), findsOneWidget);
      await tester.tap(find.byTooltip('Edit plan'));
      await tester.pumpAndSettle();

      await tester.enterText(find.widgetWithText(TextField, 'Plan name (e.g. Strength block)'), 'Week B');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilterChip, 'Push day'));
      await tester.pumpAndSettle();
      await tester.tap(planSave);
      await tester.pumpAndSettle();

      final plan = (await h.services.plansRepo.readPlans()).single;
      expect([plan.label, plan.sessionIds, plan.schedule], ['Week B', ['yoga'], {'2': 'yoga'}]);
      expect(find.text('We: Yoga flow'), findsOneWidget);
    });

    uiTest('editing a plan and turning its schedule off removes the schedule', (tester) async {
      final h = await openPlans(tester, extra: (s) async {
        await s.plansRepo.writePlans(const [Plan(id: 'p1', label: 'Week', sessionIds: ['yoga'], schedule: {'1': 'yoga'})]);
      });
      await tester.tap(find.byTooltip('Edit plan'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilterChip, 'Assign sessions to days'));
      await tester.pumpAndSettle();
      await tester.tap(planSave);
      await tester.pumpAndSettle();
      expect((await h.services.plansRepo.readPlans()).single.schedule, isNull);
    });

    uiTest('cancelling an edit changes nothing', (tester) async {
      final h = await openPlans(tester, extra: (s) async {
        await s.plansRepo.writePlans(const [Plan(id: 'p1', label: 'Week', sessionIds: ['yoga'])]);
      });
      await tester.tap(find.byTooltip('Edit plan'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Plan name (e.g. Strength block)'), 'Changed');
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Week'), findsOneWidget);
      expect((await h.services.plansRepo.readPlans()).single.label, 'Week');
    });

    uiTest('delete asks first; deleting the active plan deactivates it', (tester) async {
      final h = await openPlans(tester, extra: (s) async {
        await s.plansRepo.writePlans(const [Plan(id: 'p1', label: 'Week', sessionIds: ['yoga'])]);
        await s.plansRepo.writeActivePlanId('p1');
      });
      await tester.tap(find.byTooltip('Delete plan'));
      await tester.pumpAndSettle();
      expect(find.text('Delete "Week"?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(await h.services.plansRepo.readPlans(), hasLength(1));

      await tester.tap(find.byTooltip('Delete plan'));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Delete');
      expect(await h.services.plansRepo.readPlans(), isEmpty);
      expect(await h.services.plansRepo.readActivePlanId(), isNull);
    });

    uiTest('every session can be put in a plan even while another plan is active (the web editor hides them)', (tester) async {
      await openPlans(tester, extra: (s) async {
        await s.plansRepo.writePlans(const [Plan(id: 'p1', label: 'Only yoga', sessionIds: ['yoga'])]);
        await s.plansRepo.writeActivePlanId('p1');
      });
      await tester.ensureVisible(find.text('New plan'));
      await tester.tap(find.text('New plan'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FilterChip, 'Push day'), findsOneWidget);
      expect(find.widgetWithText(FilterChip, 'Yoga flow'), findsOneWidget);
    });
  });
}
