import 'dart:io';

import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/sqlite_repositories.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/rules.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/sync/day_hash.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';

DayData day(String date, {String notes = '', String type = 'yoga'}) => DayData(
      date: date,
      sessionType: type,
      main: [const WorkoutItem(id: 'ID-1', text: 'Pose')],
      mainNotes: notes,
    );

WorkoutDataSnapshot snap(Map<String, DayData> data, {Map<String, String>? deleted, int version = 1}) =>
    WorkoutDataSnapshot(version: version, updatedAt: '2026-10-01T00:00:00.000Z', data: data, deletedDays: deleted);

void main() {
  late LocalDatabase store;
  setUp(() => store = LocalDatabase.inMemory());
  tearDown(() => store.close());

  group('workout data', () {
    late SqliteWorkoutDataRepository repo;
    setUp(() => repo = SqliteWorkoutDataRepository(store));

    test('is null until something is written', () async {
      expect(await repo.readSnapshot(), isNull);
      expect(await repo.readAll(), isEmpty);
    });

    test('round-trips days and keeps the snapshot timestamp', () async {
      await repo.writeSnapshot(snap({'2026-10-01': day('2026-10-01', notes: 'a'), '2026-10-02': day('2026-10-02')}));
      final read = await repo.readSnapshot();
      expect(read!.updatedAt, '2026-10-01T00:00:00.000Z');
      expect(read.data.keys, unorderedEquals(['2026-10-01', '2026-10-02']));
      expect(read.data['2026-10-01']!.mainNotes, 'a');
      expect(read.data['2026-10-01']!.main.single.id, 'ID-1');
    });

    test('a write replaces the set: days not in the snapshot are removed', () async {
      await repo.writeAll({'2026-10-01': day('2026-10-01'), '2026-10-02': day('2026-10-02')});
      await repo.writeAll({'2026-10-02': day('2026-10-02', notes: 'kept')});
      final all = await repo.readAll();
      expect(all.keys, ['2026-10-02']);
      expect(all['2026-10-02']!.mainNotes, 'kept');
    });

    test('sanitises on write the way the web app does (equipment is dropped)', () async {
      const withEquipment = DayData(
        date: '2026-10-01',
        sessionType: 'yoga',
        main: [WorkoutItem(id: 'ID-1', text: 'Pose', equipment: 'mat', target: '1 min')],
      );
      await repo.writeAll({'2026-10-01': withEquipment});
      final item = (await repo.readAll())['2026-10-01']!.main.single;
      expect(item.equipment, isNull);
      expect(item.target, '1 min');
    });

    test('refuses a snapshot from a newer schema and writes nothing', () async {
      await repo.writeAll({'2026-10-01': day('2026-10-01')});
      await expectLater(repo.writeSnapshot(snap({}, version: 2)), throwsStateError);
      expect((await repo.readAll()).keys, ['2026-10-01']);
    });

    test('skips an unreadable day row without losing the others', () async {
      await repo.writeAll({'2026-10-01': day('2026-10-01'), '2026-10-02': day('2026-10-02')});
      store.db.execute("UPDATE days SET json = '{not json' WHERE date = '2026-10-01'");
      expect((await repo.readAll()).keys, ['2026-10-02']);
    });

    group('tombstones', () {
      test('recordDeletion stores the hash of the sanitised day', () async {
        final d = day('2026-10-01', notes: 'x');
        await repo.writeAll({});
        await repo.recordDeletion('2026-10-01', d);
        final expected = dayContentHash(sanitizeDayData(d.toJson(), '2026-10-01'));
        expect((await repo.readSnapshot())!.deletedDays, {'2026-10-01': expected});
      });

      test('a day written again is no longer deleted', () async {
        await repo.writeAll({});
        await repo.recordDeletion('2026-10-01', day('2026-10-01'));
        await repo.writeAll({'2026-10-01': day('2026-10-01')});
        expect((await repo.readSnapshot())!.deletedDays, isEmpty);
      });

      test('deletedDays on a write is the set to keep; omitting it leaves them alone', () async {
        await repo.writeAll({});
        await repo.recordDeletion('2026-10-01', day('2026-10-01'));
        await repo.recordDeletion('2026-10-02', day('2026-10-02'));

        await repo.writeSnapshot(snap({}));
        expect((await repo.readSnapshot())!.deletedDays!.keys, unorderedEquals(['2026-10-01', '2026-10-02']));

        await repo.writeSnapshot(snap({}, deleted: {'2026-10-02': 'h'}));
        expect((await repo.readSnapshot())!.deletedDays!.keys, ['2026-10-02']);
      });

      test('a write never adds tombstones, even for dates it lists', () async {
        await repo.writeSnapshot(snap({}, deleted: {'2026-10-05': 'h'}));
        expect((await repo.readSnapshot())!.deletedDays, isEmpty);
      });
    });
  });

  group('templates', () {
    late SqliteTemplateRepository repo;
    setUp(() => repo = SqliteTemplateRepository(store, now: () => DateTime.utc(2026, 10, 3)));

    test('is null until written, then round-trips and sanitises', () async {
      expect(await repo.readTemplates(), isNull);
      await repo.writeTemplates({
        'yoga': const TemplateData(
          label: '  Flow  ',
          warmup: [TemplateRow(id: 'ID-1', text: '  Cat-cow  ', target: '1 min')],
        ),
      });
      final read = (await repo.readTemplates())!;
      expect(read['yoga']!.label, 'Flow');
      expect(read['yoga']!.warmup.single.text, 'Cat-cow');
      expect((await repo.readSnapshot())!.updatedAt, '2026-10-03T00:00:00.000Z');
    });

    test('an emptied built-in section is refilled with ids that stay the same on every read', () async {
      // The sanitiser refills it from defaults that have no ids, and a row without an id would get a new random one on
      // every read (so sync would see the template as changed each time).
      await repo.writeTemplates({'tennis': const TemplateData(main: [TemplateRow(id: 'm', text: 'Rally')])});
      final first = (await repo.readTemplates())!['tennis']!;
      final second = (await repo.readTemplates())!['tennis']!;
      expect(first.warmup, isNotEmpty);
      expect(first.warmup.every((r) => r.id != null && r.id!.isNotEmpty), isTrue);
      expect(first.warmup.map((r) => r.id), second.warmup.map((r) => r.id));
      expect(first.warmup.map((r) => r.text), contains('2-3 min brisk walk / light jog'));
    });

    test('keeps session order', () async {
      await repo.writeTemplates({'b': const TemplateData(), 'a': const TemplateData(), 'c': const TemplateData()});
      expect((await repo.readTemplates())!.keys, ['b', 'a', 'c']);
    });

    test('refuses a newer schema', () async {
      await expectLater(
        repo.writeSnapshot(const TemplateSnapshot(version: 2, updatedAt: 'x', data: {})),
        throwsStateError,
      );
    });
  });

  group('plans', () {
    late SqlitePlansRepository repo;
    setUp(() => repo = SqlitePlansRepository(store));

    test('round-trips plans in order, with and without a schedule', () async {
      await repo.writePlans(const [
        Plan(id: 'plan-1', label: 'A', sessionIds: ['gym', 'swim'], schedule: {'0': 'gym'}),
        Plan(id: 'plan-2', label: 'B', sessionIds: []),
      ]);
      final plans = await repo.readPlans();
      expect(plans.map((p) => p.id), ['plan-1', 'plan-2']);
      expect(plans.first.schedule, {'0': 'gym'});
      expect(plans.last.schedule, isNull);
    });

    test('no plans stored reads as an empty list and a null snapshot', () async {
      expect(await repo.readPlans(), isEmpty);
      expect(await repo.readSnapshot(), isNull);
    });

    test('active plan id is set, read and cleared', () async {
      expect(await repo.readActivePlanId(), isNull);
      await repo.writeActivePlanId('plan-1');
      expect(await repo.readActivePlanId(), 'plan-1');
      await repo.writeActivePlanId(null);
      expect(await repo.readActivePlanId(), isNull);
    });
  });

  group('account settings', () {
    late SqliteAccountSettingsRepository repo;
    setUp(() => repo = SqliteAccountSettingsRepository(store));

    test('reads all-null settings on a fresh database', () async {
      final s = (await repo.readSnapshot()).data;
      expect([s.activePlanId, s.planParams, s.planMeta], [null, null, null]);
    });

    test('round-trips, and null clears a field', () async {
      SettingsSnapshot snapshot(SyncedSettings s) => SettingsSnapshot(version: 1, updatedAt: 'x', data: s);
      await repo.writeSnapshot(snapshot(const SyncedSettings(
        activePlanId: 'plan-1',
        planParams: {'goal': 'strength', 'daysPerWeek': 3},
        planMeta: {'split': 'PPL', 'schedule': ['push']},
      )));
      var s = (await repo.readSnapshot()).data;
      expect(s.activePlanId, 'plan-1');
      expect(s.planParams, {'goal': 'strength', 'daysPerWeek': 3});
      expect(s.planMeta, {'split': 'PPL', 'schedule': ['push']});

      await repo.writeSnapshot(snapshot(const SyncedSettings(activePlanId: 'plan-1')));
      s = (await repo.readSnapshot()).data;
      expect([s.activePlanId, s.planParams, s.planMeta], ['plan-1', null, null]);
    });

    test('shares the active plan with the plans repository', () async {
      await SqlitePlansRepository(store).writeActivePlanId('plan-9');
      expect((await repo.readSnapshot()).data.activePlanId, 'plan-9');
    });
  });

  group('sync settings', () {
    late SqliteSyncSettingsRepository repo;
    setUp(() => repo = SqliteSyncSettingsRepository(store));

    test('defaults, then round-trips', () async {
      expect((await repo.readSettings()).lastSyncedAt, isNull);
      await repo.writeSettings(const SyncSettings(lastSyncedAt: '2026-10-03T00:00:00.000Z', lastError: 'boom'));
      final s = await repo.readSettings();
      expect([s.lastSyncedAt, s.lastError], ['2026-10-03T00:00:00.000Z', 'boom']);
    });

    test('sync base round-trips and ignores non-string hashes', () async {
      expect((await repo.readSyncBase()).days, isEmpty);
      await repo.writeSyncBase(const SyncBase(days: {'2026-10-01': 'h1'}, plans: {'plan-1': 'h2'}));
      final b = await repo.readSyncBase();
      expect([b.days, b.templates, b.plans, b.settings], [{'2026-10-01': 'h1'}, {}, {'plan-1': 'h2'}, {}]);

      store.writeDoc('sync_base', {
        'days': {'a': 'ok', 'b': 5},
        'templates': 'legacy-single-hash',
        'plans': ['x'],
      });
      final tolerant = await repo.readSyncBase();
      expect([tolerant.days, tolerant.templates, tolerant.plans], [{'a': 'ok'}, {}, {}]);
    });

    test('restore points keep their order and a rewrite replaces the list', () async {
      await repo.writeRestorePoints([
        {'id': 'newest', 'createdAt': '3'},
        {'id': 'middle', 'createdAt': '2'},
        {'id': 'oldest', 'createdAt': '1'},
      ]);
      expect((await repo.readRestorePoints()).map((p) => p['id']), ['newest', 'middle', 'oldest']);
      await repo.writeRestorePoints([
        {'id': 'only', 'createdAt': '4'},
      ]);
      expect((await repo.readRestorePoints()).map((p) => p['id']), ['only']);
    });
  });

  group('database', () {
    test('a document that is not valid JSON reads as absent', () {
      store.db.execute("INSERT INTO docs (key, json) VALUES ('templates', '{broken')");
      expect(store.readDoc('templates'), isNull);
    });

    test('a failed transaction leaves nothing behind', () {
      expect(
        () => store.transaction(() {
          store.writeDoc('a', 1);
          throw StateError('boom');
        }),
        throwsStateError,
      );
      expect(store.readDoc('a'), isNull);
    });

    test('data survives closing and reopening the file', () async {
      final dir = Directory.systemTemp.createTempSync('daily_grind_test');
      final path = '${dir.path}/app.db';
      addTearDown(() => dir.deleteSync(recursive: true));

      var file = LocalDatabase.open(path);
      await SqliteWorkoutDataRepository(file).writeAll({'2026-10-01': day('2026-10-01', notes: 'persisted')});
      await SqlitePlansRepository(file).writeActivePlanId('plan-1');
      file.close();

      file = LocalDatabase.open(path);
      addTearDown(file.close);
      expect((await SqliteWorkoutDataRepository(file).readAll())['2026-10-01']!.mainNotes, 'persisted');
      expect(await SqlitePlansRepository(file).readActivePlanId(), 'plan-1');
    });

    test('refuses to open a database from a newer app', () {
      final dir = Directory.systemTemp.createTempSync('daily_grind_test');
      final path = '${dir.path}/app.db';
      addTearDown(() => dir.deleteSync(recursive: true));

      LocalDatabase.open(path)
        ..db.userVersion = LocalDatabase.schemaVersion + 1
        ..close();
      expect(() => LocalDatabase.open(path), throwsStateError);
    });
  });
}
