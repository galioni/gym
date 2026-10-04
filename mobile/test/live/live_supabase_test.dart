/// The real adapters against a REAL local Supabase stack (never the hosted project): sign-up through the auth REST API, the
/// Postgrest gateway and allowance, the SyncService over in-memory SQLite "devices", row level security and Realtime.
///
/// Skipped unless the stack's address and keys are in the environment, so a normal `flutter test` never needs Docker:
///
///   LIVE_SUPABASE_URL=http://localhost:64321 LIVE_SUPABASE_ANON_KEY=... LIVE_SUPABASE_SERVICE_KEY=... \
///     flutter test test/live/live_supabase_test.dart
///
/// Uses throwaway users (deleted at the end) and only ever their own rows.
@Timeout(Duration(minutes: 3))
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:daily_grind/app/app_services.dart';
import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/postgrest_row_gateway.dart';
import 'package:daily_grind/data/postgrest_sync_allowance.dart';
import 'package:daily_grind/data/supabase_sync_signal.dart';
import 'package:daily_grind/sync/sync_merge.dart';
import 'package:daily_grind/sync/sync_service.dart' show ConflictResolutionMap;
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:postgrest/postgrest.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthClientOptions, AuthFlowType, SupabaseClient;

import '../support/sync_device.dart' show mkDay, mkPlan, mkTemplate;

final _url = Platform.environment['LIVE_SUPABASE_URL'];
final _anon = Platform.environment['LIVE_SUPABASE_ANON_KEY'];
final _service = Platform.environment['LIVE_SUPABASE_SERVICE_KEY'];
final _configured = _url != null && _anon != null && _service != null;

/// Only a stack on this machine: the test flips plan flags and creates users, which must never happen on a hosted project.
bool get _isLocal => _url != null && const ['localhost', '127.0.0.1'].contains(Uri.parse(_url!).host);

const _password = 'live-test-Pa55word!';
final _createdUsers = <String>[];
var _counter = 0;

// Implicit flow: the PKCE flow needs the storage a real app provides.
SupabaseClient _client() => SupabaseClient(_url!, _anon!, authOptions: const AuthClientOptions(authFlowType: AuthFlowType.implicit));

PostgrestClient _admin() => PostgrestClient('$_url/rest/v1', headers: {'apikey': _service!, 'Authorization': 'Bearer $_service'});

class Account {
  Account(this.email, this.id);

  final String email;
  final String id;
}

/// Creates a user (the stack auto-confirms sign-ups) and returns it.
Future<Account> newUser(String label) async {
  final email = 'live-$label-${DateTime.now().millisecondsSinceEpoch}-${_counter++}@example.test';
  final client = _client();
  final response = await client.auth.signUp(email: email, password: _password);
  final id = response.user!.id;
  _createdUsers.add(id);
  await client.dispose();
  return Account(email, id);
}

Future<void> setPlan(Account a, String plan) => _admin().from('subscriptions').upsert({
      'user_id': a.id,
      'plan': plan,
      'status': plan == 'pro' ? 'active' : 'inactive',
    }, onConflict: 'user_id');

/// One installation: its own empty in-memory database, signed in as [account], talking to the real stack.
class LiveDevice {
  LiveDevice._(this.client, this.services);

  final SupabaseClient client;
  final AppServices services;

  static Future<LiveDevice> signedIn(Account account) async {
    final client = _client();
    await client.auth.signInWithPassword(email: account.email, password: _password);
    final services = AppServices(
      database: LocalDatabase.inMemory(),
      cloud: PostgrestRowGateway(client.rest, currentUserId: () => client.auth.currentUser?.id),
      allowance: PostgrestSyncAllowance(client.rest),
      currentUserId: () => client.auth.currentUser?.id,
    );
    return LiveDevice._(client, services);
  }

  Future<SyncNowResult> sync({ConflictResolutionMap resolution = const {}}) => services.syncService.syncNow(resolution: resolution);

  Future<void> close() async {
    services.dispose();
    await client.dispose();
  }
}

String _day(int daysAgo) {
  final d = DateTime.now().subtract(Duration(days: daysAgo));
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

void main() {
  final skip = _configured ? null : 'set LIVE_SUPABASE_URL, LIVE_SUPABASE_ANON_KEY and LIVE_SUPABASE_SERVICE_KEY to run against a local stack';

  setUpAll(() {
    if (_configured && !_isLocal) throw StateError('LIVE_SUPABASE_URL must point at localhost; refusing to run against $_url');
  });

  tearDownAll(() async {
    if (!_configured) return;
    for (final id in _createdUsers) {
      final r = await http.delete(Uri.parse('$_url/auth/v1/admin/users/$id'), headers: {'apikey': _service!, 'Authorization': 'Bearer $_service'});
      if (r.statusCode >= 300) stderr.writeln('could not delete throwaway user $id (${r.statusCode})');
    }
  });

  group('Pro account across two devices', skip: skip, () {
    late Account pro;
    late LiveDevice one;
    late LiveDevice two;
    final today = _day(0);

    setUpAll(() async {
      pro = await newUser('pro');
      await setPlan(pro, 'pro');
      one = await LiveDevice.signedIn(pro);
      two = await LiveDevice.signedIn(pro);
    });

    tearDownAll(() async {
      try {
        await one.close();
        await two.close();
      } catch (_) {
        // Setup did not get that far.
      }
    });

    test('a day, templates and a plan pushed from one device arrive on the other', () async {
      await one.services.workoutRepo.saveDay(mkDay(today, 'from device one'));
      await one.services.templateRepo.writeTemplates({'yoga': mkTemplate('Yoga flow')});
      await one.services.plansRepo.writePlans([mkPlan('p1', 'Plan one')]);

      final pushed = await one.sync();
      expect(pushed.status, SyncOutcome.success, reason: pushed.message);

      final rows = await _admin().from('workout_days').select().eq('user_id', pro.id);
      expect(rows.map((r) => r['day']), contains(today));
      final templates = await _admin().from('templates').select().eq('user_id', pro.id);
      expect(templates.map((r) => r['session_type']), contains('yoga'));
      final plans = await _admin().from('plans').select().eq('user_id', pro.id);
      expect(plans.map((r) => r['id']), contains('p1'));

      final pulled = await two.sync();
      expect(pulled.status, SyncOutcome.success, reason: pulled.message);
      expect((await two.services.workoutRepo.readAll())[today]!.mainNotes, 'from device one');
      expect((await two.services.templateRepo.readTemplates())!['yoga']!.label, 'Yoga flow');
      expect((await two.services.plansRepo.readPlans()).map((p) => p.label), contains('Plan one'));
    });

    test('a day deleted on one device is deleted on the other (tombstone)', () async {
      final day = (await one.services.workoutRepo.readAll())[today]!;
      await one.services.workoutRepo.removeDay(today, day);
      final pushed = await one.sync();
      expect(pushed.status, SyncOutcome.success, reason: pushed.message);

      final row = (await _admin().from('workout_days').select().eq('user_id', pro.id).eq('day', today)).single;
      expect(row['deleted_at'], isNotNull, reason: 'the cloud keeps a marker, not the content');

      final pulled = await two.sync();
      expect(pulled.status, SyncOutcome.success, reason: pulled.message);
      expect(await two.services.workoutRepo.readAll(), isNot(contains(today)));
    });

    test('both devices editing the same day is a conflict, and the chosen side wins everywhere', () async {
      final date = _day(1);
      await one.services.workoutRepo.saveDay(mkDay(date, 'start'));
      expect((await one.sync()).status, SyncOutcome.success);
      expect((await two.sync()).status, SyncOutcome.success);

      await one.services.workoutRepo.saveDay(mkDay(date, 'edited on one'));
      await two.services.workoutRepo.saveDay(mkDay(date, 'edited on two'));
      expect((await one.sync()).status, SyncOutcome.success);

      final clash = await two.sync();
      expect(clash.status, SyncOutcome.conflict, reason: clash.message);
      expect(clash.conflicts.map((c) => c.entity), contains(SyncEntity.workoutData));

      final resolved = await two.sync(resolution: {SyncEntity.workoutData: ConflictResolution.keepLocal});
      expect(resolved.status, SyncOutcome.success, reason: resolved.message);
      final row = (await _admin().from('workout_days').select().eq('user_id', pro.id).eq('day', date)).single;
      expect(jsonEncode(row), contains('edited on two'));

      expect((await one.sync()).status, SyncOutcome.success);
      expect((await one.services.workoutRepo.readAll())[date]!.mainNotes, 'edited on two');
    });
  });

  group('Free account', skip: skip, () {
    // The plan rules are switched on in production but off by default in a fresh local database: turn them on for these tests only.
    const flags = ['sync_allowance', 'free_history_window'];
    late Map<String, bool> original;

    setUpAll(() async {
      final rows = await _admin().from('app_flags').select('name, enabled').inFilter('name', flags);
      original = {for (final r in rows) r['name'] as String: r['enabled'] as bool};
      await _admin().from('app_flags').update({'enabled': true}).inFilter('name', flags);
    });

    tearDownAll(() async {
      for (final e in original.entries) {
        await _admin().from('app_flags').update({'enabled': e.value}).eq('name', e.key);
      }
    });

    test('uploads only the recent window, then waits for the monthly allowance', () async {
      final free = await newUser('free');
      final device = await LiveDevice.signedIn(free);
      addTearDown(device.close);

      await device.services.workoutRepo.saveDay(mkDay(_day(0), 'today'));
      await device.services.workoutRepo.saveDay(mkDay(_day(30), 'a month ago'));

      final first = await device.sync();
      expect(first.status, SyncOutcome.success, reason: first.message);
      final days = (await _admin().from('workout_days').select().eq('user_id', free.id)).map((r) => r['day']).toList();
      expect(days, contains(_day(0)));
      expect(days, isNot(contains(_day(30))), reason: 'older days stay on the device');
      expect(await device.services.workoutRepo.readAll(), contains(_day(30)), reason: 'and are not lost locally');

      // The first upload opened a 10-minute window in which more writes still count as the same sync; let it close.
      await _admin().from('sync_windows').update({'opened_at': DateTime.now().toUtc().subtract(const Duration(minutes: 11)).toIso8601String()}).eq('user_id', free.id);

      await device.services.workoutRepo.saveDay(mkDay(_day(0), 'edited again'));
      final second = await device.sync();
      expect(second.status, SyncOutcome.error);
      expect(second.reason, SyncFailReason.allowance);
      expect(second.nextAvailableAt, isNotNull, reason: 'the database says when the next sync opens');
    });

    test('the database itself refuses a day older than the window, even sent directly', () async {
      final free = await newUser('free-direct');
      final client = _client();
      addTearDown(client.dispose);
      await client.auth.signInWithPassword(email: free.email, password: _password);
      await client.rest.rpc('begin_sync');
      Object? error;
      try {
        await client.rest.from('workout_days').upsert({'user_id': free.id, 'day': _day(30), 'session_type': 'yoga'}, onConflict: 'user_id,day');
      } catch (e) {
        error = e;
      }
      expect(error, isA<PostgrestException>());
      stdout.writeln('direct old-day write refused with code ${(error as PostgrestException).code}');
    });
  });

  group('row level security', skip: skip, () {
    test('another account can neither read nor write a user\'s rows', () async {
      final owner = await newUser('rls-owner');
      final intruder = await newUser('rls-intruder');
      await setPlan(owner, 'pro');
      await setPlan(intruder, 'pro');
      final ownerDevice = await LiveDevice.signedIn(owner);
      final intruderDevice = await LiveDevice.signedIn(intruder);
      addTearDown(ownerDevice.close);
      addTearDown(intruderDevice.close);

      await ownerDevice.services.workoutRepo.saveDay(mkDay(_day(0), 'private'));
      await ownerDevice.services.templateRepo.writeTemplates({'yoga': mkTemplate('Private')});
      expect((await ownerDevice.sync()).status, SyncOutcome.success);

      final rest = intruderDevice.client.rest;
      expect(await rest.from('workout_days').select().eq('user_id', owner.id), isEmpty);
      expect(await rest.from('templates').select().eq('user_id', owner.id), isEmpty);
      expect(await rest.from('subscriptions').select().eq('user_id', owner.id), isEmpty);

      Object? error;
      try {
        await rest.from('workout_days').upsert({'user_id': owner.id, 'day': _day(5), 'session_type': 'yoga'}, onConflict: 'user_id,day');
      } catch (e) {
        error = e;
      }
      expect(error, isNotNull, reason: 'writing into someone else\'s account is refused');
      expect(await _admin().from('workout_days').select().eq('user_id', owner.id).eq('day', _day(5)), isEmpty);

      // And the intruder's own sync brings in none of the owner's data.
      expect((await intruderDevice.sync()).status, SyncOutcome.success);
      expect(await intruderDevice.services.workoutRepo.readAll(), isEmpty);
    });
  });

  group('realtime hint', skip: skip, () {
    test('a change on one device is announced to the same account\'s other device', () async {
      final ping = await http.get(Uri.parse('$_url/realtime/v1/api/ping')).timeout(const Duration(seconds: 5), onTimeout: () => http.Response('', 599));
      // Realtime answers its ping with {"message":"Success"} (older versions: "pong"); the gateway's own fallback text means no Realtime.
      final alive = ping.statusCode < 400 && (ping.body.contains('Success') || ping.body.trim() == 'pong');
      if (!alive) {
        markTestSkipped('this stack has no Realtime service (start it with: npm run gym:up -- realtime; the gateway answered HTTP ${ping.statusCode} to /realtime/v1/api/ping)');
        return;
      }
      // The hint ships switched off (production has it on): turn it on for this test only.
      final flag = await _admin().from('app_flags').select('enabled').eq('name', 'realtime_sync').single();
      final wasOn = flag['enabled'] as bool;
      await _admin().from('app_flags').update({'enabled': true}).eq('name', 'realtime_sync');
      addTearDown(() => _admin().from('app_flags').update({'enabled': wasOn}).eq('name', 'realtime_sync'));

      final account = await newUser('realtime');
      await setPlan(account, 'pro');
      final listener = await LiveDevice.signedIn(account);
      final writer = await LiveDevice.signedIn(account);
      addTearDown(listener.close);
      addTearDown(writer.close);

      final heard = Completer<void>();
      final stop = SupabaseSyncSignal(listener.client).subscribe(account.id, () {
        if (!heard.isCompleted) heard.complete();
      });
      addTearDown(stop);
      await Future<void>.delayed(const Duration(seconds: 3));

      await writer.services.workoutRepo.saveDay(mkDay(_day(0), 'ping'));
      expect((await writer.sync()).status, SyncOutcome.success);
      await heard.future.timeout(const Duration(seconds: 15));
    });
  });
}
