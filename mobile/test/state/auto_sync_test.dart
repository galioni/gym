import 'dart:async';

import 'package:daily_grind/state/auto_sync.dart';
import 'package:daily_grind/sync/sync_signal.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

/// The automatic sync triggers (the Dart twin of the web's useAutoSync tests): when it syncs, when it must not, and how it
/// tells the user.
class FakeSignal implements SyncSignal {
  final listeners = <void Function()>[];
  int subscribed = 0;
  int unsubscribed = 0;
  String? lastUser;

  @override
  void Function() subscribe(String userId, void Function() onChange) {
    subscribed++;
    lastUser = userId;
    listeners.add(onChange);
    return () {
      unsubscribed++;
      listeners.remove(onChange);
    };
  }

  void fire() {
    for (final l in [...listeners]) {
      l();
    }
  }
}

const ok = SyncNowResult(status: SyncOutcome.success, message: 'Sync completed.');

class Rig {
  Rig(this.async, {SyncSignal? signal, this._mismatch = false}) {
    sync = AutoSync(
      syncNow: ({bool automatic = false, bool downloadOnly = false}) {
        calls.add((automatic: automatic, downloadOnly: downloadOnly));
        return handler();
      },
      onLocalDataChanged: () => reloads++,
      onConflicts: conflictReports.add,
      onStorageLimit: limitReports.add,
      onOwnerMismatch: () => ownerPrompts++,
      hasOwnerMismatch: (_) => _mismatch,
      signal: signal,
      now: () => async.getClock(DateTime(2026, 10, 3, 12)).now(),
    );
  }

  final FakeAsync async;
  final bool _mismatch;
  late final AutoSync sync;
  final calls = <({bool automatic, bool downloadOnly})>[];
  Future<SyncNowResult> Function() handler = () async => ok;
  int reloads = 0;
  int ownerPrompts = 0;
  final conflictReports = <List<SyncConflict>>[];
  final limitReports = <String>[];

  void ready({String? user = 'user-1', bool downloadOnly = false, bool ready = true}) {
    sync.configure(ready: ready, userId: user, downloadOnly: downloadOnly);
    async.flushMicrotasks();
  }

  void elapse(Duration d) {
    async.elapse(d);
    async.flushMicrotasks();
  }
}

SyncConflict conflict(String path) => SyncConflict(
      entity: SyncEntity.workoutData,
      localUpdatedAt: 'l',
      cloudUpdatedAt: 'c',
      previewPaths: [path],
    );

void withRig(void Function(Rig rig, FakeAsync async) body, {SyncSignal? signal, bool mismatch = false}) {
  fakeAsync((async) {
    final rig = Rig(async, signal: signal, mismatch: mismatch);
    body(rig, async);
    rig.sync.dispose();
    async.flushTimers();
  });
}

void main() {
  group('when it syncs', () {
    test('once as soon as data is loaded and someone is signed in, marked automatic', () {
      withRig((rig, _) {
        rig.ready();
        expect(rig.calls, [(automatic: true, downloadOnly: false)]);
      });
    });

    test('a download-only account asks the sync to send nothing', () {
      withRig((rig, _) {
        rig.ready(downloadOnly: true);
        expect(rig.calls, [(automatic: true, downloadOnly: true)]);
      });
    });

    test('nothing until local data has loaded, then straight away', () {
      withRig((rig, _) {
        rig.ready(ready: false);
        expect(rig.calls, isEmpty);
        rig.ready();
        expect(rig.calls, hasLength(1));
      });
    });

    test('nothing without a signed-in user', () {
      withRig((rig, _) {
        rig.ready(user: null);
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 10));
        expect(rig.calls, isEmpty);
      });
    });

    test('a few seconds after edits, and a burst of edits makes a single sync', () {
      withRig((rig, _) {
        rig.ready();
        rig.calls.clear();
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 2));
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 2));
        expect(rig.calls, isEmpty, reason: 'the second edit restarted the wait');
        rig.elapse(const Duration(seconds: 1));
        expect(rig.calls, hasLength(1));
      });
    });

    test('when the connection comes back, and not while offline', () {
      withRig((rig, _) {
        rig.ready();
        rig.calls.clear();
        rig.sync.setOnline(false);
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 5));
        expect(rig.calls, isEmpty, reason: 'skipped while offline');
        rig.sync.setOnline(true);
        async(rig);
        expect(rig.calls, hasLength(1));
      });
    });

    test('when the app returns to the foreground, but not more than once every 15 seconds', () {
      withRig((rig, _) {
        rig.ready();
        rig.calls.clear();
        rig.sync.setForeground(false);
        rig.elapse(const Duration(seconds: 5));
        rig.sync.setForeground(true);
        async(rig);
        expect(rig.calls, isEmpty, reason: 'the last sync was only 5s ago');

        rig.sync.setForeground(false);
        rig.elapse(const Duration(seconds: 20));
        rig.sync.setForeground(true);
        async(rig);
        expect(rig.calls, hasLength(1));
      });
    });

    test('polls every five minutes in the foreground, and not in the background', () {
      withRig((rig, _) {
        rig.sync.start();
        rig.ready();
        rig.calls.clear();
        rig.elapse(const Duration(minutes: 5));
        expect(rig.calls, hasLength(1));
        rig.sync.setForeground(false);
        rig.calls.clear();
        rig.elapse(const Duration(minutes: 10));
        expect(rig.calls, isEmpty);
      });
    });
  });

  group('single flight', () {
    test('a trigger during a sync is not lost: one more sync runs after it ends', () {
      withRig((rig, _) {
        final gate = Completer<SyncNowResult>();
        rig.handler = () => gate.future;
        rig.ready();
        expect(rig.calls, hasLength(1));

        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 3));
        expect(rig.calls, hasLength(1), reason: 'still running');

        rig.handler = () async => ok;
        gate.complete(ok);
        rig.async.flushMicrotasks();
        rig.elapse(const Duration(milliseconds: 600));
        expect(rig.calls, hasLength(2));
      });
    });

    test('many triggers during one sync cause a single extra sync', () {
      withRig((rig, _) {
        final gate = Completer<SyncNowResult>();
        rig.handler = () => gate.future;
        rig.ready();
        for (var i = 0; i < 5; i++) {
          rig.sync.setOnline(false);
          rig.sync.setOnline(true);
        }
        rig.handler = () async => ok;
        gate.complete(ok);
        rig.async.flushMicrotasks();
        rig.elapse(const Duration(seconds: 2));
        expect(rig.calls, hasLength(2));
      });
    });

    test('nothing extra runs if it is disposed first', () {
      withRig((rig, _) {
        final gate = Completer<SyncNowResult>();
        rig.handler = () => gate.future;
        rig.ready();
        rig.sync.setOnline(false);
        rig.sync.setOnline(true);
        rig.sync.dispose();
        gate.complete(ok);
        rig.async.flushMicrotasks();
        rig.elapse(const Duration(seconds: 2));
        expect(rig.calls, hasLength(1));
      });
    });

    test('keeps working after a sync throws', () {
      withRig((rig, _) {
        rig.handler = () => throw StateError('boom');
        rig.ready();
        rig.handler = () async => ok;
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 3));
        expect(rig.calls, hasLength(2));
      });
    });
  });

  group('account ownership', () {
    test('another account\'s data: asks once and never syncs, until the user decides', () {
      withRig((rig, _) {
        rig.ready();
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 5));
        rig.sync.setOnline(false);
        rig.sync.setOnline(true);
        expect(rig.calls, isEmpty);
        expect(rig.ownerPrompts, 1);
      }, mismatch: true);
    });

    test('once the user has decided, syncing resumes (and the check is made again)', () {
      var mismatch = true;
      fakeAsync((async) {
        final calls = <int>[];
        var prompts = 0;
        final sync = AutoSync(
          syncNow: ({bool automatic = false, bool downloadOnly = false}) async {
            calls.add(1);
            return ok;
          },
          onLocalDataChanged: () {},
          onConflicts: (_) {},
          onStorageLimit: (_) {},
          onOwnerMismatch: () => prompts++,
          hasOwnerMismatch: (_) => mismatch,
        );
        sync.configure(ready: true, userId: 'u', downloadOnly: false);
        async.flushMicrotasks();
        expect([calls.length, prompts], [0, 1]);

        mismatch = false;
        sync.ownerResolved();
        sync.localChanged();
        async.elapse(const Duration(seconds: 4));
        async.flushMicrotasks();
        expect(calls.length, 1);
        sync.dispose();
        async.flushTimers();
      });
    });
  });

  group('when another device changes the account', () {
    test('syncs soon after a signal, once for a burst of them', () {
      final signal = FakeSignal();
      withRig((rig, _) {
        rig.ready();
        rig.calls.clear();
        signal.fire();
        signal.fire();
        signal.fire();
        rig.elapse(const Duration(milliseconds: 1400));
        expect(rig.calls, isEmpty);
        rig.elapse(const Duration(milliseconds: 200));
        expect(rig.calls, hasLength(1));
        expect(signal.lastUser, 'user-1');
      }, signal: signal);
    });

    test('does not listen before data is loaded, without a user, or on an account that only downloads', () {
      final signal = FakeSignal();
      withRig((rig, _) {
        rig.ready(ready: false);
        rig.ready(user: null);
        rig.ready(downloadOnly: true);
        expect(signal.subscribed, 0);
        rig.ready();
        expect(signal.subscribed, 1);
      }, signal: signal);
    });

    test('stops listening when the account stops qualifying, and on dispose; a waiting signal is dropped', () {
      final signal = FakeSignal();
      withRig((rig, _) {
        rig.ready();
        rig.calls.clear();
        signal.fire();
        rig.ready(downloadOnly: true); // now a Free account: stop listening
        expect(signal.unsubscribed, 1);
        rig.calls.clear();
        rig.elapse(const Duration(seconds: 3));
        expect(rig.calls, isEmpty, reason: 'the signal that was waiting was dropped');

        rig.ready();
        rig.sync.dispose();
        expect(signal.unsubscribed, 2);
      }, signal: signal);
    });

    test('works the same without a signal', () {
      withRig((rig, _) {
        rig.ready();
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 3));
        expect(rig.calls, hasLength(2));
      });
    });
  });

  group('telling the user', () {
    test('reloads in-memory state only when the sync changed local data', () {
      withRig((rig, _) {
        rig.handler = () async => const SyncNowResult(status: SyncOutcome.success, message: 'ok', appliedToLocal: false);
        rig.ready();
        expect(rig.reloads, 0);
        rig.handler = () async => const SyncNowResult(status: SyncOutcome.success, message: 'ok', appliedToLocal: true);
        rig.sync.localChanged();
        rig.elapse(const Duration(seconds: 3));
        expect(rig.reloads, 1);
      });
    });

    test('reports a conflict once per distinct set, and again after it clears', () {
      withRig((rig, _) {
        SyncNowResult conflicted(String path) =>
            SyncNowResult(status: SyncOutcome.conflict, message: 'c', conflicts: [conflict(path)]);
        void trigger() {
          rig.sync.localChanged();
          rig.elapse(const Duration(seconds: 3));
        }

        rig.handler = () async => conflicted('2026-10-01.mainNotes');
        rig.ready();
        trigger();
        trigger();
        expect(rig.conflictReports, hasLength(1), reason: 'the same conflict on retry is not announced again');

        rig.handler = () async => conflicted('2026-10-02.mainNotes');
        trigger();
        expect(rig.conflictReports, hasLength(2));

        rig.handler = () async => ok;
        trigger();
        rig.handler = () async => conflicted('2026-10-02.mainNotes');
        trigger();
        expect(rig.conflictReports, hasLength(3), reason: 'it cleared, so it is news again');
      });
    });

    test('announces a storage limit once, stays quiet on retries, and announces again after a success', () {
      withRig((rig, _) {
        const limited = SyncNowResult(status: SyncOutcome.error, message: 'limit', reason: SyncFailReason.storageLimit);
        void trigger() {
          rig.sync.localChanged();
          rig.elapse(const Duration(seconds: 3));
        }

        rig.handler = () async => limited;
        rig.ready();
        trigger();
        expect(rig.limitReports, ['limit']);

        rig.handler = () async => ok;
        trigger();
        rig.handler = () async => limited;
        trigger();
        expect(rig.limitReports, hasLength(2));
      });
    });

    test('ordinary failures are not announced as storage limits', () {
      withRig((rig, _) {
        rig.handler = () async => const SyncNowResult(status: SyncOutcome.error, message: 'database down');
        rig.ready();
        expect(rig.limitReports, isEmpty);
      });
    });
  });
}

/// Lets the microtasks the "online" and "foreground" triggers started finish.
void async(Rig rig) => rig.async.flushMicrotasks();
