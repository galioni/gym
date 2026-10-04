import 'dart:async';

import 'package:daily_grind/data/postgres_repositories.dart';
import 'package:daily_grind/data/row_gateway.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/sync/history_limited_cloud.dart';
import 'package:daily_grind/sync/sync_errors.dart';
import 'package:daily_grind/sync/sync_merge.dart' show ConflictResolution;
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_gateway.dart';
import '../support/sync_device.dart';

/// Behaviour of the sync engine that the golden scenarios cannot express: concurrency, a user edit that lands in the
/// middle of a sync, and how much the cloud is asked for.

/// A gateway that lets a test act at the moment the cloud is read (the middle of a sync).
class HookGateway extends FakeGateway {
  HookGateway(super.nowMs);

  Future<void> Function(UserTable table)? beforeSelectAll;
  Completer<void>? gate;

  @override
  Future<List<Json>> selectAll(UserTable table) async {
    if (gate != null && table == UserTable.workoutDays) await gate!.future;
    await beforeSelectAll?.call(table);
    return super.selectAll(table);
  }
}

const d1 = '2026-10-01', d2 = '2026-10-02';

void main() {
  late int nowMs;
  late HookGateway gateway;
  DateTime clock() => DateTime.fromMillisecondsSinceEpoch(nowMs, isUtc: true);

  Device device() => Device(gateway, clock);

  setUp(() {
    nowMs = DateTime.utc(2026, 10, 3, 12).millisecondsSinceEpoch;
    gateway = HookGateway(() => nowMs);
  });

  void tick([Duration by = const Duration(minutes: 1)]) => nowMs += by.inMilliseconds;

  group('single flight', () {
    test('a call without a resolution joins the sync already running', () async {
      final a = device()..days.data[d1] = mkDay(d1, 'a');
      gateway.gate = Completer<void>();

      final first = a.service.syncNow(automatic: true);
      await Future<void>.delayed(Duration.zero);
      final second = a.service.syncNow(automatic: true);
      gateway.gate!.complete();
      final results = await Future.wait([first, second]);

      expect(identical(results[0], results[1]), isTrue);
      expect(gateway.calls.where((c) => c == 'selectAll:workout_days'), hasLength(1));
    });

    test('a call with a resolution waits for the running sync, then runs its own', () async {
      final a = device()..days.data[d1] = mkDay(d1, 'a');
      gateway.gate = Completer<void>();

      final first = a.service.syncNow(automatic: true);
      await Future<void>.delayed(Duration.zero);
      final second = a.service.syncNow(resolution: {SyncEntity.workoutData: ConflictResolution.keepLocal});
      gateway.gate!.complete();
      await Future.wait([first, second]);

      expect(gateway.calls.where((c) => c == 'selectAll:workout_days'), hasLength(2));
    });

    test('the next sync can start once one has finished, even after a failure', () async {
      final a = device()..days.data[d1] = mkDay(d1, 'a');
      gateway.refuseWrites = SyncException('boom');
      expect((await a.service.syncNow()).status, SyncOutcome.error);
      gateway.refuseWrites = null;
      expect((await a.service.syncNow()).status, SyncOutcome.success);
    });
  });

  group('an edit made while a sync is running', () {
    test('is never overwritten by the sync, and the next sync reconciles both', () async {
      final a = device()..days.data[d1] = mkDay(d1, 'v1');
      final b = device();
      await a.service.syncNow(automatic: true);
      tick();
      await b.service.syncNow(automatic: true);
      tick();
      b.days.data[d1] = mkDay(d1, 'v2 from b');
      await b.service.syncNow(automatic: true);
      tick();

      // The user types a new day on A after the sync has read local storage but before it has finished.
      gateway.beforeSelectAll = (table) async {
        if (table == UserTable.workoutDays) a.days.data[d2] = mkDay(d2, 'typed during sync');
      };
      final during = await a.service.syncNow(automatic: true);
      gateway.beforeSelectAll = null;

      expect(during.status, SyncOutcome.success);
      expect(during.appliedToLocal, isFalse, reason: 'the incoming day was held back, not applied over the edit');
      expect(a.days.data[d2]!.mainNotes, 'typed during sync');
      expect(a.days.data[d1]!.mainNotes, 'v1');

      tick();
      final after = await a.service.syncNow(automatic: true);
      expect(after.status, SyncOutcome.success);
      expect(a.days.data[d1]!.mainNotes, 'v2 from b');
      expect(a.days.data[d2]!.mainNotes, 'typed during sync');
      expect(gateway.tables[UserTable.workoutDays]![d2]!['main_notes'], 'typed during sync');
    });
  });

  group('incremental reads of workout days', () {
    test('after the first full read only changed rows are asked for, and a full read comes back every hour', () async {
      final writer = device();
      for (var i = 1; i <= 5; i++) {
        writer.days.data['2026-10-0$i'] = mkDay('2026-10-0$i', 'n$i');
      }
      await writer.service.syncNow(automatic: true);

      final reader = device();
      tick();
      await reader.service.syncNow(automatic: true);
      expect(gateway.calls.where((c) => c == 'selectAll:workout_days').length, greaterThanOrEqualTo(2));
      gateway.calls.clear();

      tick();
      await reader.service.syncNow(automatic: true);
      expect(gateway.calls, contains('selectChangedSince:workout_days'));
      expect(gateway.calls, isNot(contains('selectAll:workout_days')));
      gateway.calls.clear();

      tick(const Duration(minutes: 61));
      await reader.service.syncNow(automatic: true);
      expect(gateway.calls, contains('selectAll:workout_days'), reason: 'removals are only visible to a full read');
    });

    test('a change made by another device is picked up by the incremental read', () async {
      final a = device()..days.data[d1] = mkDay(d1, 'v1');
      final b = device();
      await a.service.syncNow(automatic: true);
      tick();
      await b.service.syncNow(automatic: true);
      tick();
      a.days.data[d1] = mkDay(d1, 'v2');
      await a.service.syncNow(automatic: true);
      tick();

      gateway.calls.clear();
      await b.service.syncNow(automatic: true);
      expect(gateway.calls, contains('selectChangedSince:workout_days'));
      expect(b.days.data[d1]!.mainNotes, 'v2');
    });

    test('a different signed-in user always starts with a full read', () async {
      final repo = PostgresWorkoutDataRepository(gateway, now: clock);
      final a = device()..days.data[d1] = mkDay(d1, 'v1');
      await a.service.syncNow(automatic: true);
      await repo.readSnapshot();
      gateway.calls.clear();
      await repo.readSnapshot();
      expect(gateway.calls, ['selectChangedSince:workout_days']);

      final other = _OtherUserGateway(gateway);
      final repo2 = PostgresWorkoutDataRepository(other, now: clock);
      await repo2.readSnapshot();
      other.user = 'user-2';
      gateway.calls.clear();
      await repo2.readSnapshot();
      expect(gateway.calls, ['selectAll:workout_days']);
    });
  });

  group('writing under an account limit', () {
    Templates seven() => {for (var i = 1; i <= 7; i++) 't$i': mkTemplate('Move $i')};

    test('edits go first, then deletions, then as many new rows as fit; the limit is reported last', () async {
      gateway.caps[UserTable.templates] = 5;
      final repo = PostgresTemplateRepository(gateway, now: clock);
      await repo.writeTemplates({for (var i = 1; i <= 5; i++) 't$i': mkTemplate('Move $i')});
      await repo.readSnapshot();

      // Edit t1, delete t2 and t3, add four new ones: only two fit once the deletions have made room (5-2=3 live, cap 5).
      final next = {
        't1': mkTemplate('Move 1 edited'),
        't4': mkTemplate('Move 4'),
        't5': mkTemplate('Move 5'),
        'n1': mkTemplate('New 1'),
        'n2': mkTemplate('New 2'),
        'n3': mkTemplate('New 3'),
        'n4': mkTemplate('New 4'),
      };
      await expectLater(repo.writeTemplates(next), throwsA(isA<CloudLimitError>()));

      final stored = gateway.tables[UserTable.templates]!.keys.toList()..sort();
      expect(stored, ['n1', 'n2', 't1', 't4', 't5']);
      expect(gateway.tables[UserTable.templates]!['t1']!['label'], 'Move 1 edited');
    });

    test('a single refused new row is reported straight away', () async {
      gateway.caps[UserTable.templates] = 1;
      final repo = PostgresTemplateRepository(gateway, now: clock);
      await repo.writeTemplates({'a': mkTemplate('A')});
      await repo.readSnapshot();
      await expectLater(repo.writeTemplates({'a': mkTemplate('A'), 'b': mkTemplate('B')}), throwsA(isA<CloudLimitError>()));
      expect(gateway.tables[UserTable.templates]!.keys, ['a']);
    });

    test('a full sync stores what fits and keeps everything on the device', () async {
      gateway.caps[UserTable.templates] = 5;
      final a = device()..templates.set(seven());
      final result = await a.service.syncNow(automatic: true);
      expect(result.status, SyncOutcome.error);
      expect(result.reason, SyncFailReason.storageLimit);
      expect(gateway.tables[UserTable.templates], hasLength(5));
      expect(a.templates.data, hasLength(7));
    });
  });

  group('download only', () {
    test('sends nothing to the cloud, however much has changed here', () async {
      final a = device()..days.data[d1] = mkDay(d1, 'local only');
      a.templates.set({'push': mkTemplate('Push')});
      final result = await a.service.syncNow(automatic: true, downloadOnly: true);
      expect(result.status, SyncOutcome.success);
      expect(gateway.upserted.values.every((n) => n == 0), isTrue);
      expect(gateway.tables[UserTable.workoutDays], isEmpty);
    });
  });

  group('HistoryLimitedCloudWorkout', () {
    test('drops days and deletions older than the cutoff on the way up, reads are untouched', () async {
      final inner = PostgresWorkoutDataRepository(gateway, now: clock);
      final limited = HistoryLimitedCloudWorkout(inner, '2026-10-01');
      await limited.writeSnapshot(WorkoutDataSnapshot(
        version: 1,
        updatedAt: 'x',
        data: {'2026-09-30': mkDay('2026-09-30', 'old'), d1: mkDay(d1, 'edge'), d2: mkDay(d2, 'new')},
      ));
      expect((await limited.readAll()).keys, unorderedEquals([d1, d2]));

      await limited.writeSnapshot(WorkoutDataSnapshot(
        version: 1,
        updatedAt: 'x',
        data: {d2: mkDay(d2, 'new')},
        deletedDays: {'2026-09-30': 'h', d1: 'whatever-hash'},
      ));
      expect(gateway.tables[UserTable.workoutDays]![d1]!['deleted_at'], isNotNull);
      expect(gateway.tables[UserTable.workoutDays]!.containsKey('2026-09-30'), isFalse);
    });
  });
}

/// The same database seen by a different signed-in user.
class _OtherUserGateway implements RowGateway {
  _OtherUserGateway(this._inner);

  final HookGateway _inner;
  String user = 'user-1';

  @override
  Future<String> requireUserId() async => user;

  @override
  Future<List<Json>> selectAll(UserTable table) => _inner.selectAll(table);

  @override
  Future<List<Json>> selectChangedSince(UserTable table, String since) => _inner.selectChangedSince(table, since);

  @override
  Future<void> upsertRows(UserTable table, List<Json> rows) => _inner.upsertRows(table, rows);

  @override
  Future<void> markDaysDeleted(Map<String, String> days) => _inner.markDaysDeleted(days);

  @override
  Future<void> deleteMissing(UserTable table, List<String> keep) => _inner.deleteMissing(table, keep);
}
