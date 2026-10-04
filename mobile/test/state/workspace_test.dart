import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/repositories.dart';
import 'package:daily_grind/data/sqlite_repositories.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/domain/workout_transitions.dart';
import 'package:daily_grind/state/workspace.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';

/// A template repository that can be told to fail its writes.
class FailingTemplates implements TemplateRepository {
  FailingTemplates(this.inner);

  final TemplateRepository inner;
  bool failWrites = false;

  @override
  Future<Templates?> readTemplates() => inner.readTemplates();

  @override
  Future<void> writeTemplates(Templates t) async {
    if (failWrites) throw StateError('disk full');
    return inner.writeTemplates(t);
  }

  @override
  Future<TemplateSnapshot?> readSnapshot() => inner.readSnapshot();

  @override
  Future<void> writeSnapshot(TemplateSnapshot s) => inner.writeSnapshot(s);
}

const yoga = TemplateData(
  label: 'Yoga flow',
  warmup: [TemplateRow(id: 'w1', text: 'Cat-cow', target: '1 min')],
  main: [TemplateRow(id: 'm1', text: 'Sun salutation', target: '5 rounds'), TemplateRow(id: 'm2', text: 'Warrior II')],
);

void main() {
  late LocalDatabase db;
  late SqliteTemplateRepository templateRepo;
  late SqlitePlansRepository plansRepo;
  late FailingTemplates flaky;
  late Workspace ws;
  var ids = 0;

  setUp(() async {
    db = LocalDatabase.inMemory();
    templateRepo = SqliteTemplateRepository(db);
    plansRepo = SqlitePlansRepository(db);
    flaky = FailingTemplates(templateRepo);
    ids = 0;
    await templateRepo.writeTemplates({'yoga': yoga, 'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')])});
    ws = Workspace(templates: flaky, plans: plansRepo, now: () => DateTime.utc(2026, 10, 3, 12), idGen: () => '${ids++}'.padLeft(7, '0'));
    await ws.load();
  });
  tearDown(() {
    ws.dispose();
    db.close();
  });

  group('editing a section', () {
    List<TemplateRow> rows(List<String> texts) => [for (final t in texts) TemplateRow(id: 'r-$t', text: t)];

    test('saving stores it, shows what was stored, and counts as a change', () async {
      final before = ws.revision;
      final errors = await ws.saveSection('yoga', WorkoutSection.main, [
        const TemplateRow(id: 'm1', text: '  Sun salutation  ', target: '  6 rounds '),
        const TemplateRow(id: 'new', text: 'Child pose'),
      ]);
      expect(errors, isEmpty);
      expect(ws.revision, greaterThan(before));

      final stored = (await templateRepo.readTemplates())!['yoga']!;
      expect(stored.main.map((r) => r.text), ['Sun salutation', 'Child pose']);
      expect(stored.main.first.target, '6 rounds', reason: 'cleaned up on the way in');
      expect(ws.templates['yoga']!.main.first.text, 'Sun salutation', reason: 'the screen shows the stored copy');
      expect(ws.templates['yoga']!.warmup.single.text, 'Cat-cow', reason: 'the other section is untouched');
    });

    test('rows that would not be accepted are returned as errors and nothing is saved', () async {
      final errors = await ws.saveSection('yoga', WorkoutSection.main, rows(['Fine', '   ']));
      expect(errors.map((e) => '${e.rowIndex}:${e.message}'), ['1:Exercise name is required.']);
      expect((await templateRepo.readTemplates())!['yoga']!.main.map((r) => r.text), ['Sun salutation', 'Warrior II']);
      expect(await ws.undoSection('yoga', WorkoutSection.main), isFalse, reason: 'a rejected save leaves nothing to undo');
    });

    test('undo puts back what the section had before its last save, once', () async {
      await ws.saveSection('yoga', WorkoutSection.main, rows(['Only one']));
      expect(ws.templates['yoga']!.main.map((r) => r.text), ['Only one']);

      expect(await ws.undoSection('yoga', WorkoutSection.main), isTrue);
      expect(ws.templates['yoga']!.main.map((r) => r.text), ['Sun salutation', 'Warrior II']);
      expect((await templateRepo.readTemplates())!['yoga']!.main, hasLength(2), reason: 'and that is what is stored');
      expect(await ws.undoSection('yoga', WorkoutSection.main), isFalse, reason: 'nothing left to undo');
    });

    test('undo is per section: undoing the warm-up does not touch the main list', () async {
      await ws.saveSection('yoga', WorkoutSection.warmup, rows(['Changed warm-up']));
      await ws.saveSection('yoga', WorkoutSection.main, rows(['Changed main']));
      await ws.undoSection('yoga', WorkoutSection.warmup);
      expect(ws.templates['yoga']!.warmup.single.text, 'Cat-cow');
      expect(ws.templates['yoga']!.main.single.text, 'Changed main');
    });

    test('reset puts the built-in rows back for a built-in session, and can be undone', () async {
      await ws.saveSection('tennis', WorkoutSection.main, rows(['My own']));
      await ws.resetSection('tennis', WorkoutSection.main);
      expect(ws.templates['tennis']!.main.map((r) => r.text), contains('Tennis session (60 min)'));
      expect(ws.templates['tennis']!.main.every((r) => r.id != null), isTrue, reason: 'stored rows always have ids');

      await ws.undoSection('tennis', WorkoutSection.main);
      expect(ws.templates['tennis']!.main.single.text, 'My own');
    });

    test('reset empties a section of a session the user made (it has no built-in rows)', () async {
      await ws.resetSection('yoga', WorkoutSection.main);
      expect(ws.templates['yoga']!.main, isEmpty);
    });

    test('the session video link is saved, trimmed to nothing clears it', () async {
      await ws.saveVideoUrl('yoga', 'https://youtu.be/dQw4w9WgXcQ');
      expect(ws.videoUrlFor('yoga'), 'https://youtu.be/dQw4w9WgXcQ');
      expect((await templateRepo.readTemplates())!['yoga']!.videoUrl, 'https://youtu.be/dQw4w9WgXcQ');
      await ws.saveVideoUrl('yoga', '');
      expect(ws.videoUrlFor('yoga'), isNull);
    });

    test('a failed save keeps the edit on screen, reports it, and the next good save clears the report', () async {
      flaky.failWrites = true;
      await ws.saveSection('yoga', WorkoutSection.main, rows(['Unsaved']));
      expect(ws.lastTemplateError, 'Failed to save template changes.');
      expect(ws.templates['yoga']!.main.single.text, 'Unsaved');
      expect((await templateRepo.readTemplates())!['yoga']!.main, hasLength(2), reason: 'storage did not change');

      flaky.failWrites = false;
      await ws.saveSection('yoga', WorkoutSection.main, rows(['Saved now']));
      expect(ws.lastTemplateError, isNull);
    });
  });

  group('session types', () {
    test('creating one adds an empty user template and returns its id', () async {
      final result = await ws.addSessionType('Morning Yoga');
      expect([result.ok, result.sessionType], [true, 'morning-yoga']);
      expect(ws.templates['morning-yoga']!.source, 'user');
      expect((await templateRepo.readTemplates())!.keys, contains('morning-yoga'));
      expect(ws.allSessionOptions.map((o) => o.value), contains('morning-yoga'));
    });

    test('a name that is empty or taken is refused with the web app\'s words, and nothing changes', () async {
      final empty = await ws.addSessionType('***');
      expect(empty.message, 'Enter a session type name using letters or numbers.');
      final taken = await ws.addSessionType('yoga');
      expect(taken.message, 'Session type "Yoga" already exists.');
      expect(ws.templates.keys, ['yoga', 'tennis']);
    });

    test('renaming changes the label, not the id', () async {
      final result = await ws.renameSession('yoga', 'Calm flow');
      expect(result.ok, isTrue);
      expect(ws.templates['yoga']!.label, 'Calm flow');
      expect(ws.allSessionOptions.firstWhere((o) => o.value == 'yoga').label, 'Calm flow');
    });

    test('deleting removes the template (and its undo history)', () async {
      await ws.saveSection('yoga', WorkoutSection.main, [const TemplateRow(id: 'x', text: 'X')]);
      final result = await ws.removeSessionType('yoga');
      expect(result.ok, isTrue);
      expect(ws.templates.keys, ['tennis']);
      expect((await templateRepo.readTemplates())!.keys, ['tennis']);
      expect(await ws.undoSection('yoga', WorkoutSection.main), isFalse);
      expect((await ws.removeSessionType('nope')).message, 'Session type "Nope" not found.');
    });

    test('a failed save is reported as an error result', () async {
      flaky.failWrites = true;
      final result = await ws.addSessionType('New thing');
      expect([result.ok, result.message], [false, 'Failed to save template changes.']);
    });

    test('replacing every template at once (a generated plan) stores them all and forgets undo history', () async {
      await ws.saveSection('yoga', WorkoutSection.main, [const TemplateRow(id: 'x', text: 'X')]);
      await ws.replaceTemplates({'push': const TemplateData(label: 'Push', source: 'ai', main: [TemplateRow(id: 'p', text: 'Bench')])});
      expect(ws.templates.keys, ['push']);
      expect((await templateRepo.readTemplates())!['push']!.source, 'ai');
      expect(await ws.undoSection('yoga', WorkoutSection.main), isFalse);
    });

    test('replacing fails loudly when it cannot be saved', () async {
      flaky.failWrites = true;
      await expectLater(ws.replaceTemplates({'a': const TemplateData()}), throwsStateError);
    });
  });

  group('plans', () {
    test('creating one trims the label, gives it an id, and stores it', () async {
      final plan = await ws.createPlan('  Strength block  ', ['yoga', 'tennis']);
      expect(plan.label, 'Strength block');
      expect(plan.id, 'plan_${DateTime.utc(2026, 10, 3, 12).millisecondsSinceEpoch}_00000');
      expect(plan.schedule, isNull);
      expect((await plansRepo.readPlans()).single.id, plan.id);
      expect(ws.plans.single.sessionIds, ['yoga', 'tennis']);
    });

    test('two plans made in the same instant never share an id', () async {
      final ids = <String>{};
      final same = Workspace(templates: flaky, plans: plansRepo, now: () => DateTime.utc(2026, 10, 3), idGen: () => 'aaaaaaa');
      await same.load();
      for (var i = 0; i < 3; i++) {
        ids.add((await same.createPlan('P$i', [])).id);
        // The fixed random part collides every time; the id must still change.
        if (i < 2) await Future<void>.delayed(Duration.zero);
      }
      expect(ids.length, 3);
      same.dispose();
    });

    test('an empty schedule is not kept; a real one is', () async {
      final none = await ws.createPlan('A', ['yoga'], schedule: {});
      final some = await ws.createPlan('B', ['yoga'], schedule: {'0': 'yoga', '4': 'yoga'});
      expect(none.schedule, isNull);
      expect(some.schedule, {'0': 'yoga', '4': 'yoga'});
      expect((await plansRepo.readPlans()).last.schedule, {'0': 'yoga', '4': 'yoga'});
    });

    test('updating replaces label, sessions and schedule, and an empty schedule clears it', () async {
      final plan = await ws.createPlan('Old', ['yoga'], schedule: {'1': 'yoga'});
      await ws.updatePlan(plan.id, label: ' New ', sessionIds: ['tennis'], schedule: null);
      final stored = (await plansRepo.readPlans()).single;
      expect([stored.label, stored.sessionIds, stored.schedule], ['New', ['tennis'], null]);
    });

    test('updating one plan leaves the others alone and keeps their order', () async {
      final a = await ws.createPlan('A', ['yoga']);
      final b = await ws.createPlan('B', ['yoga']);
      await ws.updatePlan(a.id, label: 'A2', sessionIds: []);
      expect(ws.plans.map((p) => p.label), ['A2', 'B']);
      expect(ws.plans.last.id, b.id);
    });

    test('the active plan is set, and clearing it works', () async {
      final plan = await ws.createPlan('A', ['yoga']);
      await ws.setActivePlan(plan.id);
      expect([ws.activePlan?.id, await plansRepo.readActivePlanId()], [plan.id, plan.id]);
      await ws.setActivePlan(null);
      expect([ws.activePlan, await plansRepo.readActivePlanId()], [null, null]);
    });

    test('deleting the active plan also deactivates it; deleting another leaves it active', () async {
      final a = await ws.createPlan('A', ['yoga']);
      final b = await ws.createPlan('B', ['yoga']);
      await ws.setActivePlan(a.id);

      await ws.deletePlan(b.id);
      expect(ws.activePlanId, a.id);
      await ws.deletePlan(a.id);
      expect([ws.plans, ws.activePlanId, await plansRepo.readActivePlanId()], [isEmpty, null, null]);
    });

    test('the day screen\'s picker follows the active plan; an empty plan shows everything', () async {
      final plan = await ws.createPlan('Only tennis', ['tennis']);
      await ws.setActivePlan(plan.id);
      expect(ws.sessionOptions.map((o) => o.value), ['tennis']);
      expect(ws.allSessionOptions.map((o) => o.value), containsAll(['yoga', 'tennis']), reason: 'the editors still see everything');
      await ws.updatePlan(plan.id, label: 'Empty', sessionIds: []);
      expect(ws.sessionOptions, hasLength(2));
    });
  });
}
