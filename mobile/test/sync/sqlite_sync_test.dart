import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/postgres_repositories.dart';
import 'package:daily_grind/data/sqlite_repositories.dart';
import 'package:daily_grind/data/sync_owner.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/data/row_gateway.dart';
import 'package:daily_grind/sync/sync_merge.dart' show ConflictResolution;
import 'package:daily_grind/sync/sync_service.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_gateway.dart';
import '../support/sync_device.dart';

/// The sync engine running over the real on-device storage (SQLite), not the in-memory doubles the contract replays
/// against: what the app will actually do. Two phones share one fake cloud.
class Phone {
  Phone(FakeGateway gateway, DateTime Function() clock, {String? Function()? user})
      : store = LocalDatabase.inMemory() {
    days = SqliteWorkoutDataRepository(store, now: clock);
    templates = SqliteTemplateRepository(store, now: clock);
    plans = SqlitePlansRepository(store, now: clock);
    account = SqliteAccountSettingsRepository(store, now: clock);
    settings = SqliteSyncSettingsRepository(store);
    owner = SqliteSyncOwner(store);
    service = SyncService(
      settingsRepository: settings,
      localWorkoutRepository: days,
      localTemplateRepository: templates,
      localPlansRepository: plans,
      localSettingsRepository: account,
      cloudWorkoutRepository: PostgresWorkoutDataRepository(gateway, now: clock),
      cloudTemplateRepository: PostgresTemplateRepository(gateway, now: clock),
      cloudPlansRepository: PostgresPlansRepository(gateway, now: clock),
      cloudSettingsRepository: PostgresAccountSettingsRepository(gateway, now: clock),
      ownership: user == null ? null : SyncOwnerGuard(owner, user),
      now: clock,
    );
  }

  final LocalDatabase store;
  late final SqliteWorkoutDataRepository days;
  late final SqliteTemplateRepository templates;
  late final SqlitePlansRepository plans;
  late final SqliteAccountSettingsRepository account;
  late final SqliteSyncSettingsRepository settings;
  late final SqliteSyncOwner owner;
  late final SyncService service;
}

const d1 = '2026-10-01', d2 = '2026-10-02';

void main() {
  late int nowMs;
  late FakeGateway gateway;
  DateTime clock() => DateTime.fromMillisecondsSinceEpoch(nowMs, isUtc: true);
  void tick() => nowMs += 60000;

  setUp(() {
    nowMs = DateTime.utc(2026, 10, 3, 12).millisecondsSinceEpoch;
    gateway = FakeGateway(() => nowMs);
  });

  test('a fresh phone downloads everything another phone uploaded, and a second sync changes nothing', () async {
    final a = Phone(gateway, clock);
    await a.days.writeAll({d1: mkDay(d1, 'one'), d2: mkDay(d2, 'two')});
    await a.templates.writeTemplates({'push': mkTemplate('Push')});
    await a.plans.writePlans([mkPlan('p1', 'Plan')]);
    await a.account.writeSnapshot(const SettingsSnapshot(
      version: 1,
      updatedAt: 'x',
      data: SyncedSettings(activePlanId: 'p1', planParams: {'goal': 'strength'}),
    ));
    expect((await a.service.syncNow(automatic: true)).status, SyncOutcome.success);
    tick();

    final b = Phone(gateway, clock); // nothing stored at all: every repository reads null
    final first = await b.service.syncNow(automatic: true);
    expect(first.status, SyncOutcome.success, reason: first.message);
    expect(first.appliedToLocal, isTrue);
    expect((await b.days.readAll()).keys, unorderedEquals([d1, d2]));
    expect((await b.days.readAll())[d1]!.mainNotes, 'one');
    expect((await b.templates.readTemplates())!.keys, ['push']);
    expect((await b.plans.readPlans()).single.label, 'Plan');
    expect((await b.account.readSnapshot()).data.activePlanId, 'p1');
    expect((await b.settings.readSettings()).lastSyncedAt, isNotNull);

    tick();
    final again = await b.service.syncNow(automatic: true);
    expect(again.status, SyncOutcome.success);
    expect(again.appliedToLocal, isFalse);
    expect(gateway.upserted[UserTable.workoutDays], 2, reason: 'nothing was uploaded twice');
  });

  test('edits and deletions travel both ways, tombstones included', () async {
    final a = Phone(gateway, clock);
    final b = Phone(gateway, clock);
    await a.days.writeAll({d1: mkDay(d1, 'keep'), d2: mkDay(d2, 'drop')});
    await a.service.syncNow(automatic: true);
    tick();
    await b.service.syncNow(automatic: true);
    tick();

    // B edits d1; A deletes d2 (what the UI does: write without it, then record the deletion).
    await b.days.writeAll({...await b.days.readAll(), d1: mkDay(d1, 'edited on b')});
    final aDays = await a.days.readAll();
    final dropped = aDays[d2]!;
    await a.days.writeAll({d1: aDays[d1]!});
    await a.days.recordDeletion(d2, dropped);
    expect((await a.days.readSnapshot())!.deletedDays!.keys, [d2]);

    await b.service.syncNow(automatic: true);
    tick();
    await a.service.syncNow(automatic: true);
    tick();
    await b.service.syncNow(automatic: true);

    expect((await a.days.readAll()).keys, [d1]);
    expect((await a.days.readAll())[d1]!.mainNotes, 'edited on b');
    expect((await b.days.readAll()).keys, [d1]);
    expect((await a.days.readSnapshot())!.deletedDays, isEmpty, reason: 'the deletion is settled, so the tombstone is cleared');
    expect(gateway.tables[UserTable.workoutDays]![d2]!['deleted_at'], isNotNull);
  });

  test('a manual sync keeps restore points on disk, newest first, and a rollback restores the data', () async {
    final a = Phone(gateway, clock);
    await a.days.writeAll({d1: mkDay(d1, 'before')});
    await a.templates.writeTemplates({'push': mkTemplate('Push')});
    await a.service.syncNow();
    tick();
    await a.days.writeAll({d1: mkDay(d1, 'after')});
    await a.service.syncNow();

    final points = await a.settings.readRestorePoints();
    expect(points, hasLength(2));
    expect(points.first['createdAt'].toString().compareTo(points.last['createdAt'].toString()), greaterThan(0));

    final result = await a.service.rollbackToRestorePoint(points.last['id'] as String);
    expect(result.status, SyncOutcome.success);
    expect((await a.days.readAll())[d1]!.mainNotes, 'before');
  });

  test('a conflict leaves both copies alone until the user chooses', () async {
    final a = Phone(gateway, clock);
    final b = Phone(gateway, clock);
    await a.days.writeAll({d1: mkDay(d1, 'v1')});
    await a.service.syncNow(automatic: true);
    tick();
    await b.service.syncNow(automatic: true);
    tick();

    await a.days.writeAll({d1: mkDay(d1, 'from a')});
    await b.days.writeAll({d1: mkDay(d1, 'from b')});
    await a.service.syncNow(automatic: true);
    tick();

    final blocked = await b.service.syncNow(automatic: true);
    expect(blocked.status, SyncOutcome.conflict);
    expect(blocked.conflicts.single.entity, SyncEntity.workoutData);
    expect((await b.days.readAll())[d1]!.mainNotes, 'from b');
    expect(gateway.tables[UserTable.workoutDays]![d1]!['main_notes'], 'from a');

    final resolved = await b.service.syncNow(resolution: {SyncEntity.workoutData: ConflictResolution.keepCloud});
    expect(resolved.status, SyncOutcome.success);
    expect((await b.days.readAll())[d1]!.mainNotes, 'from a');
  });

  group('account ownership', () {
    test('the first account to sync claims the device; another account is refused before anything is read', () async {
      String? user = 'user-1';
      final a = Phone(gateway, clock, user: () => user);
      await a.days.writeAll({d1: mkDay(d1, 'mine')});

      expect((await a.service.syncNow(automatic: true)).status, SyncOutcome.success);
      expect(a.owner.check('user-1'), OwnerCheck.owned);

      user = 'user-2';
      gateway.calls.clear();
      final refused = await a.service.syncNow(automatic: true);
      expect(refused.status, SyncOutcome.error);
      expect(refused.reason, SyncFailReason.otherAccount);
      expect(gateway.calls, isEmpty, reason: 'nothing was read from, or written to, the cloud');
    });

    test('switching owner wipes the previous account\'s data and assigns the device', () async {
      final a = Phone(gateway, clock);
      await a.days.writeAll({d1: mkDay(d1, 'old account')});
      await a.days.recordDeletion(d2, mkDay(d2, 'x'));
      await a.templates.writeTemplates({'push': mkTemplate('Push')});
      await a.settings.writeRestorePoints([
        {'id': '1'},
      ]);
      expect(a.owner.check('user-1'), OwnerCheck.claimed);

      a.owner.switchOwner('user-2');

      expect(await a.days.readSnapshot(), isNull);
      expect(await a.templates.readSnapshot(), isNull);
      expect(await a.settings.readRestorePoints(), isEmpty);
      expect(a.owner.check('user-2'), OwnerCheck.owned);
      expect(a.owner.check('user-1'), OwnerCheck.mismatch);
    });

    test('with no signed-in user the guard does not block', () async {
      final a = Phone(gateway, clock, user: () => null);
      expect(await SyncOwnerGuard(a.owner, () => null).check(), OwnerStatus.ok);
    });
  });

  test('templates written through the app keep their shape through a full cloud round trip', () async {
    final a = Phone(gateway, clock);
    await a.templates.writeTemplates({
      'yoga': const TemplateData(
        label: 'Flow',
        focus: 'mobility',
        source: 'user',
        warmup: [TemplateRow(id: 'w1', text: 'Cat-cow', target: '1 min', equipment: 'mat', description: 'slow')],
        main: [TemplateRow(id: 'm1', text: 'Sun salutation')],
      ),
    });
    await a.service.syncNow(automatic: true);
    tick();
    final b = Phone(gateway, clock);
    await b.service.syncNow(automatic: true);

    final t = (await b.templates.readTemplates())!['yoga']!;
    expect([t.label, t.focus, t.source], ['Flow', 'mobility', 'user']);
    expect(t.warmup.single.equipment, 'mat');
    expect(t.warmup.single.description, 'slow');
    expect(t.main.single.target, isNull);
    expect(t.main.single.id, 'm1');
  });
}
