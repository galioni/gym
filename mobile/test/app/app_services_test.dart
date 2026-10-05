import 'dart:async';

import 'package:clock/clock.dart';
import 'package:daily_grind/app/app_events.dart';
import 'package:daily_grind/app/app_services.dart';
import 'package:daily_grind/app/connectivity.dart';
import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/row_gateway.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/sync/sync_allowance.dart';
import 'package:daily_grind/sync/sync_errors.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_gateway.dart';
import '../support/sync_device.dart' show mkDay;

/// The wiring of the signed-in app: what it loads, when it syncs, and what it tells the user.
class Plan {
  Plan({this.status = SyncAllowanceStatus.unlimited, this.statusFails = false});

  SyncAllowanceStatus status;
  bool statusFails;
}

class StubAllowance implements SyncAllowance {
  StubAllowance(this.plan);

  final Plan plan;

  @override
  Future<SyncGrant> begin() async => SyncGrant(historyDays: historyDaysFor(plan.status));

  @override
  Future<SyncAllowanceStatus> status() async {
    if (plan.statusFails) throw const SyncException('down');
    return plan.status;
  }
}

const freePlan = SyncAllowanceStatus(enforced: true, isPro: false, nextAvailableAt: '2026-11-03T00:00:00.000Z');

class Rig {
  Rig(this.async, {Plan? plan, String? user = 'user-1', FakeGateway? sharedCloud, ManualConnectivity? net}) {
    this.plan = plan ?? Plan();
    clock = async.getClock(DateTime(2026, 10, 3, 12));
    cloud = sharedCloud ?? FakeGateway(() => clock.now().millisecondsSinceEpoch);
    this.net = net ?? ManualConnectivity();
    currentUser = user;
    services = AppServices(
      database: LocalDatabase.inMemory(),
      cloud: cloud,
      allowance: StubAllowance(this.plan),
      currentUserId: () => currentUser,
      connectivity: this.net,
      now: () => clock.now(),
    );
    services.events.listen(events.add);
  }

  final FakeAsync async;
  late final Plan plan;
  late final Clock clock;
  late final FakeGateway cloud;
  late final ManualConnectivity net;
  late final AppServices services;
  String? currentUser;
  final events = <AppEvent>[];

  Future<void> up() async {
    unawaited(services.start());
    async.flushMicrotasks();
  }

  void elapse(Duration d) {
    async.elapse(d);
    async.flushMicrotasks();
  }

  int get cloudDays => cloud.tables[UserTable.workoutDays]!.length;

  void dispose() => services.dispose();
}

void main() {
  Rig rigFor(FakeAsync async, {Plan? plan, String? user = 'user-1', FakeGateway? cloud, ManualConnectivity? net}) =>
      Rig(async, plan: plan, user: user, sharedCloud: cloud, net: net);

  test('start loads local data and then syncs on its own', () {
    fakeAsync((async) {
      final rig = rigFor(async);
      rig.services.workoutRepo.saveDay(mkDay('2026-10-03', 'written before start'));
      rig.up();
      final s = rig.services;

      expect([s.workspace.isLoaded, s.tracker.isLoaded], [true, true]);
      expect(s.tracker.currentDay.mainNotes, 'written before start');
      expect(s.sync.settings.lastSyncedAt, isNotNull, reason: 'the first sync has run');
      expect(rig.cloudDays, 1);
      rig.dispose();
    });
  });

  test('nothing syncs before the plan is known, and nothing without a user', () {
    fakeAsync((async) {
      final rig = rigFor(async, user: null);
      rig.services.workoutRepo.saveDay(mkDay('2026-10-03', 'x'));
      rig.up();
      rig.elapse(const Duration(minutes: 10));
      expect(rig.cloudDays, 0);
      expect(rig.services.sync.settings.lastSyncedAt, isNull);

      rig.currentUser = 'user-1';
      rig.services.userChanged();
      async.flushMicrotasks();
      expect(rig.cloudDays, 1);
      rig.dispose();
    });
  });

  test('an allowance that cannot be read counts as no limit', () {
    fakeAsync((async) {
      final rig = rigFor(async, plan: Plan(statusFails: true));
      rig.services.workoutRepo.saveDay(mkDay('2026-10-03', 'x'));
      rig.up();
      expect(rig.cloudDays, 1);
      expect(rig.services.allowanceState.isLimited, isFalse);
      rig.dispose();
    });
  });

  group('a Free account', () {
    test('its first sync on a device only downloads: nothing local is sent', () {
      fakeAsync((async) {
        final cloud = FakeGateway(() => async.getClock(DateTime(2026, 10, 3, 12)).now().millisecondsSinceEpoch);
        // Another device (already in the cloud) has one day; this one has its own.
        final other = rigFor(async, cloud: cloud);
        other.services.workoutRepo.saveDay(mkDay('2026-10-01', 'from the first phone'));
        other.up();
        other.dispose();

        final rig = rigFor(async, plan: Plan(status: freePlan), cloud: cloud);
        rig.services.workoutRepo.saveDay(mkDay('2026-10-02', 'only here'));
        rig.up();

        expect(rig.services.tracker.allData.keys, unorderedEquals(['2026-10-01', '2026-10-02']), reason: 'the cloud\'s day came down');
        expect(cloud.tables[UserTable.workoutDays]!.keys, ['2026-10-01'], reason: 'nothing was uploaded');
        expect(rig.services.allowanceState.isLimited, isTrue);
        rig.dispose();
      });
    });

    test('after that it does not sync by itself, however much it is edited', () {
      fakeAsync((async) {
        final rig = rigFor(async, plan: Plan(status: freePlan));
        rig.up();
        expect(rig.services.sync.settings.lastSyncedAt, isNotNull);
        final firstSync = rig.services.sync.settings.lastSyncedAt;

        rig.services.tracker.changeSessionType('gym');
        rig.elapse(const Duration(minutes: 12));
        expect(rig.services.sync.settings.lastSyncedAt, firstSync);
        expect(rig.cloudDays, 0, reason: 'a Free account uploads by hand');
        rig.dispose();
      });
    });
  });

  group('after start', () {
    test('an edit is sent a few seconds later, once the typing has paused', () {
      fakeAsync((async) {
        final rig = rigFor(async);
        rig.up();
        expect(rig.cloudDays, 0);

        rig.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'felt strong'));
        async.flushMicrotasks();
        rig.elapse(const Duration(seconds: 2));
        expect(rig.cloudDays, 0);
        rig.elapse(const Duration(seconds: 2));
        expect(rig.cloudDays, 1);
        expect(rig.cloud.tables[UserTable.workoutDays]!.values.single['main_notes'], 'felt strong');
        rig.dispose();
      });
    });

    test('a day another device uploaded appears on screen without a restart', () {
      fakeAsync((async) {
        final cloud = FakeGateway(() => async.getClock(DateTime(2026, 10, 3, 12)).now().millisecondsSinceEpoch);
        final phone = rigFor(async, cloud: cloud);
        final tablet = rigFor(async, cloud: cloud);
        phone.up();
        tablet.up();

        phone.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'logged on the phone'));
        async.flushMicrotasks();
        phone.elapse(const Duration(seconds: 4));
        expect(cloud.tables[UserTable.workoutDays]!.length, 1);

        tablet.services.autoSync.run(); // the poll, the focus trigger or a server signal would do this
        async.flushMicrotasks();
        tablet.elapse(const Duration(seconds: 1));
        expect(tablet.services.tracker.currentDay.mainNotes, 'logged on the phone');
        phone.dispose();
        tablet.dispose();
      });
    });

    test('a conflict is announced once, not on every retry', () {
      fakeAsync((async) {
        final cloud = FakeGateway(() => async.getClock(DateTime(2026, 10, 3, 12)).now().millisecondsSinceEpoch);
        final a = rigFor(async, cloud: cloud);
        final b = rigFor(async, cloud: cloud);
        a.services.workoutRepo.saveDay(mkDay('2026-10-03', 'v1'));
        a.up();
        b.up();
        expect(b.services.tracker.currentDay.mainNotes, 'v1');

        a.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'from a'));
        b.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'from b'));
        async.flushMicrotasks();
        a.elapse(const Duration(seconds: 4));
        b.elapse(const Duration(seconds: 4));
        b.services.autoSync.run();
        async.flushMicrotasks();
        b.elapse(const Duration(seconds: 4));

        expect(b.events.whereType<ConflictsFound>(), hasLength(1));
        expect(b.services.sync.conflicts, isNotEmpty);
        expect(b.services.tracker.currentDay.mainNotes, 'from b', reason: 'nothing was overwritten');
        a.dispose();
        b.dispose();
      });
    });

    test('an account at its storage limit is told once', () {
      fakeAsync((async) {
        final rig = rigFor(async);
        rig.cloud.caps[UserTable.workoutDays] = 1;
        rig.services.workoutRepo.saveDay(mkDay('2026-10-01', 'a'));
        rig.services.workoutRepo.saveDay(mkDay('2026-10-02', 'b'));
        rig.up();
        rig.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'c'));
        async.flushMicrotasks();
        rig.elapse(const Duration(seconds: 4));
        rig.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'd'));
        async.flushMicrotasks();
        rig.elapse(const Duration(seconds: 4));

        expect(rig.events.whereType<StorageLimitReached>(), hasLength(1));
        expect(rig.services.tracker.allData.length, 3, reason: 'everything stays on the device');
        rig.dispose();
      });
    });
  });

  group('account ownership', () {
    test('another account\'s data blocks the sync and asks; switching removes it and sync resumes', () {
      fakeAsync((async) {
        final rig = rigFor(async);
        rig.services.owner.check('someone-else'); // the device was last used by another account
        rig.services.workoutRepo.saveDay(mkDay('2026-10-03', 'their data'));
        rig.up();

        expect(rig.events.whereType<OwnerMismatch>(), hasLength(1));
        expect(rig.cloudDays, 0, reason: 'their data was not uploaded to this account');
        expect(rig.cloud.calls, isEmpty);

        rig.services.switchOwnerToCurrentUser();
        async.flushMicrotasks();
        expect(rig.services.tracker.allData, isEmpty, reason: 'the other account\'s workouts were removed from the device');

        rig.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'mine'));
        async.flushMicrotasks();
        rig.elapse(const Duration(seconds: 4));
        expect(rig.cloudDays, 1);
        rig.dispose();
      });
    });
  });

  group('the device', () {
    test('no sync while offline; it catches up when the connection returns', () {
      fakeAsync((async) {
        final net = ManualConnectivity(online: false);
        final rig = rigFor(async, net: net);
        rig.services.workoutRepo.saveDay(mkDay('2026-10-03', 'x'));
        rig.up();
        expect(rig.cloudDays, 0);

        net.set(true);
        async.flushMicrotasks();
        expect(rig.cloudDays, 1);
        rig.dispose();
      });
    });

    test('going to the background saves a running timer and pending edits without stopping the timer', () {
      fakeAsync((async) {
        final rig = rigFor(async);
        rig.services.workoutRepo.saveDay(mkDay('2026-10-03', 'x'));
        rig.up();
        rig.services.timers.main.start();
        async.elapse(const Duration(seconds: 2));
        rig.services.tracker.updateDayDebounced((d) => d.copyWith(mainNotes: 'typing'));

        rig.services.lifecycleChanged(AppLifecycleState.paused);
        async.flushMicrotasks();

        final stored = rig.services.workoutRepo.readAll();
        late Map<String, DayData> days;
        stored.then((v) => days = v);
        async.flushMicrotasks();
        expect(days['2026-10-03']!.mainTimerMs, greaterThanOrEqualTo(2000));
        expect(days['2026-10-03']!.mainNotes, 'typing');
        expect(rig.services.timers.main.isRunning, isTrue);
        rig.dispose();
      });
    });

    test('disposing stops everything: no sync fires afterwards', () {
      fakeAsync((async) {
        final rig = rigFor(async);
        rig.up();
        rig.services.tracker.updateDay((d) => d.copyWith(mainNotes: 'late'));
        rig.services.dispose();
        rig.elapse(const Duration(minutes: 10));
        expect(rig.cloudDays, 0);
        async.flushTimers();
      });
    });
  });
}
