import 'dart:convert';
import 'dart:io';

import 'package:daily_grind/data/postgrest_row_gateway.dart';
import 'package:daily_grind/data/postgrest_sync_allowance.dart';
import 'package:daily_grind/data/row_gateway.dart';
import 'package:daily_grind/sync/sync_errors.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:postgrest/postgrest.dart';

/// The real adapters against a mock HTTP layer: the exact requests the database would receive, and how its refusals
/// (HTTP 422 / 423 with the web app's SQLSTATE codes) become the errors the sync engine understands.
http.Response jsonResponse(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

http.Response pgError(String code, String message, {int status = 400, String? details}) =>
    jsonResponse({'code': code, 'message': message, 'details': ?details, 'hint': null}, status);

/// A mock whose responses carry their request, as real ones do (the PostgREST client relies on it).
MockClient mockClient(Future<http.Response> Function(http.Request request) handler) => MockClient((request) async {
      final r = await handler(request);
      return http.Response.bytes(r.bodyBytes, r.statusCode, headers: r.headers, request: request);
    });

PostgrestClient rest(MockClient mock) => PostgrestClient(
      'https://db.example.com/rest/v1',
      headers: {'apikey': 'anon'},
      httpClient: mock,
      retryEnabled: false,
    );

PostgrestRowGateway gateway(MockClient mock, {String? user = 'user-1'}) =>
    PostgrestRowGateway(rest(mock), currentUserId: () => user);

void main() {
  group('reads', () {
    test('selectAll asks for the table in a stable order, one page at a time', () async {
      final seen = <http.Request>[];
      final g = gateway(mockClient((r) async {
        seen.add(r);
        return jsonResponse([
          {'day': '2026-10-01'},
        ]);
      }));
      final rows = await g.selectAll(UserTable.templates);
      expect(rows, [
        {'day': '2026-10-01'},
      ]);
      expect(seen.single.method, 'GET');
      expect(seen.single.url.path, '/rest/v1/templates');
      expect(seen.single.url.queryParameters['order'], 'position.asc.nullslast,session_type.asc.nullslast');
      expect(seen.single.url.queryParameters['offset'], '0');
      expect(seen.single.url.queryParameters['limit'], '1000');
    });

    test('keeps asking while pages come back full', () async {
      var call = 0;
      final offsets = <String?>[];
      final g = gateway(mockClient((r) async {
        offsets.add(r.url.queryParameters['offset']);
        call++;
        final size = call == 1 ? pageSize : 3;
        return jsonResponse([for (var i = 0; i < size; i++) {'day': 'd${call}_$i'}]);
      }));
      final rows = await g.selectAll(UserTable.workoutDays);
      expect(rows, hasLength(pageSize + 3));
      expect(offsets, ['0', '1000']);
    });

    test('selectChangedSince filters on the server timestamp', () async {
      late Uri url;
      final g = gateway(mockClient((r) async {
        url = r.url;
        return jsonResponse([]);
      }));
      await g.selectChangedSince(UserTable.workoutDays, '2026-10-03T11:58:00.000Z');
      expect(url.queryParameters['updated_at'], 'gte.2026-10-03T11:58:00.000Z');
      expect(url.queryParameters['order'], 'day.asc.nullslast');
    });

    test('a database error becomes a sync failure that names the table', () async {
      final g = gateway(mockClient((_) async => pgError('42501', 'permission denied', status: 403)));
      await expectLater(
        g.selectAll(UserTable.plans),
        throwsA(isA<SyncException>().having((e) => e.message, 'message', 'Database read failed (plans): permission denied')),
      );
    });

    test('no response at all is reported as unreachable, not as a database error', () async {
      for (final failure in <Object>[const SocketException('down'), http.ClientException('reset')]) {
        final g = gateway(mockClient((_) async => throw failure));
        await expectLater(g.selectAll(UserTable.plans), throwsA(isA<SyncException>().having((e) => e.message, 'message', unreachable)));
      }
    });
  });

  group('writes', () {
    test('upsert batches of 200 with the table\'s conflict key', () async {
      final bodies = <List<dynamic>>[];
      late Uri url;
      final g = gateway(mockClient((r) async {
        url = r.url;
        bodies.add(jsonDecode(r.body) as List);
        return http.Response('', 201);
      }));
      await g.upsertRows(UserTable.workoutDays, [for (var i = 0; i < 450; i++) {'user_id': 'u', 'day': 'd$i'}]);
      expect(bodies.map((b) => b.length), [200, 200, 50]);
      expect(url.queryParameters['on_conflict'], 'user_id,day');
    });

    test('a row-limit refusal (PT422) is a CloudLimitError with the plain-language message', () async {
      final g = gateway(mockClient((_) async => pgError('PT422', 'row limit reached', status: 422)));
      await expectLater(
        g.upsertRows(UserTable.templates, [{'session_type': 'x'}]),
        throwsA(isA<CloudLimitError>()
            .having((e) => e.table, 'table', 'templates')
            .having((e) => e.message, 'message', describeLimit('templates'))),
      );
    });

    test('a refused old day (PT424) is explained as a probable wrong device date, in the same words as the web app', () async {
      final g = gateway(mockClient((_) async => pgError('PT424', 'The Free plan keeps the last 7 days in the cloud', status: 424)));
      await expectLater(
        g.upsertRows(UserTable.workoutDays, [{'user_id': 'u', 'day': '2026-09-01'}]),
        throwsA(isA<SyncException>()
            .having((e) => e.message, 'message',
                "The cloud refused a day older than the last 7 days that the Free plan keeps. This usually means this device's date or time is wrong, so please check it. Your data is safe on this device.")),
      );
      expect(describeHistoryWindow(), contains("date or time is wrong"));
    });

    test('an allowance refusal (PT423) carries the date the next sync opens', () async {
      final g = gateway(mockClient((_) async => pgError('PT423', 'sync window closed', status: 423, details: '2026-11-03T00:00:00+00:00')));
      await expectLater(
        g.upsertRows(UserTable.plans, [{'id': 'p'}]),
        throwsA(isA<SyncAllowanceError>().having((e) => e.nextAvailableAt, 'next', '2026-11-03T00:00:00.000Z')),
      );
    });

    test('an allowance refusal is also a limit error, so the engine treats it as one', () async {
      final g = gateway(mockClient((_) async => pgError('PT423', 'x', status: 423)));
      await expectLater(g.upsertRows(UserTable.plans, [{'id': 'p'}]), throwsA(isA<CloudLimitError>()));
    });

    test('any other write failure names the table and the cause', () async {
      final g = gateway(mockClient((_) async => pgError('23514', 'violates check constraint')));
      await expectLater(
        g.upsertRows(UserTable.workoutDays, [{'day': 'x'}]),
        throwsA(isA<SyncException>().having((e) => e.message, 'message', 'Database write failed (workout_days): violates check constraint')),
      );
    });
  });

  group('deletes', () {
    test('markDaysDeleted groups days by hash, scoped to the user and to days not already deleted', () async {
      final seen = <http.Request>[];
      final g = gateway(mockClient((r) async {
        seen.add(r);
        return http.Response('', 204);
      }));
      await g.markDaysDeleted({'2026-10-01': 'h1', '2026-10-02': 'h1', '2026-10-03': 'h2'});

      expect(seen, hasLength(2));
      for (final r in seen) {
        expect(r.method, 'PATCH');
        expect(r.url.path, '/rest/v1/workout_days');
        expect(r.url.queryParameters['user_id'], 'eq.user-1');
        expect(r.url.queryParameters['deleted_at'], 'is.null');
      }
      final byHash = {for (final r in seen) (jsonDecode(r.body) as Map)['deleted_hash']: r.url.queryParameters['day']};
      expect(byHash['h1'], 'in.("2026-10-01","2026-10-02")');
      expect(byHash['h2'], 'in.("2026-10-03")');
      expect((jsonDecode(seen.first.body) as Map)['deleted_at'], isA<String>());
    });

    test('deleteMissing removes only the rows that are not in keep, in batches', () async {
      final requests = <http.Request>[];
      final g = gateway(mockClient((r) async {
        requests.add(r);
        if (r.method == 'GET') {
          return jsonResponse([for (var i = 0; i < 450; i++) {'id': 'p$i'}]);
        }
        return http.Response('', 204);
      }));
      await g.deleteMissing(UserTable.plans, ['p0', 'p1']);

      expect(requests.first.url.queryParameters['select'], 'id');
      expect(requests.first.url.queryParameters['user_id'], 'eq.user-1');
      final deletes = requests.where((r) => r.method == 'DELETE').toList();
      expect(deletes, hasLength(3));
      final removed = deletes.expand((r) => RegExp(r'p\d+').allMatches(r.url.queryParameters['id']!).map((m) => m.group(0)!)).toList();
      expect(removed, hasLength(448));
      expect(removed, isNot(contains('p0')));
      expect(removed, isNot(contains('p1')));
    });

    test('nothing stale means no delete request', () async {
      final requests = <String>[];
      final g = gateway(mockClient((r) async {
        requests.add(r.method);
        return jsonResponse([
          {'session_type': 'a'},
        ]);
      }));
      await g.deleteMissing(UserTable.templates, ['a']);
      expect(requests, ['GET']);
    });
  });

  group('identity', () {
    test('requireUserId refuses without a session, and no request is made', () async {
      var called = false;
      final g = gateway(mockClient((_) async {
        called = true;
        return jsonResponse([]);
      }), user: null);
      await expectLater(g.requireUserId(), throwsA(isA<SyncException>()));
      await expectLater(g.markDaysDeleted({'2026-10-01': 'h'}), throwsA(isA<SyncException>()));
      await expectLater(g.deleteMissing(UserTable.plans, []), throwsA(isA<SyncException>()));
      expect(called, isFalse);
    });
  });

  group('PostgrestSyncAllowance', () {
    PostgrestSyncAllowance allowance(MockClient mock) => PostgrestSyncAllowance(rest(mock));

    Map<String, Object?> row({bool enforced = true, bool pro = false, String? ends, String? next}) =>
        {'enforced': enforced, 'is_pro': pro, 'window_ends_at': ends, 'next_available_at': next};

    test('begin starts the sync, then reads the plan, and a Free plan gets the history window', () async {
      final paths = <String>[];
      final a = allowance(mockClient((r) async {
        paths.add(r.url.path);
        return r.url.path.endsWith('begin_sync') ? http.Response('', 204) : jsonResponse([row()]);
      }));
      final grant = await a.begin();
      expect(paths, ['/rest/v1/rpc/begin_sync', '/rest/v1/rpc/sync_allowance']);
      expect(grant.historyDays, 7);
    });

    test('a Pro account, or an allowance that is switched off, has no history limit', () async {
      for (final r in [row(pro: true), row(enforced: false)]) {
        final a = allowance(mockClient((q) async => q.url.path.endsWith('begin_sync') ? http.Response('', 204) : jsonResponse([r])));
        expect((await a.begin()).historyDays, isNull);
      }
    });

    test('a refused window carries the date the next sync opens', () async {
      final a = allowance(mockClient((_) async => pgError('PT423', 'used', status: 423, details: '2026-11-03T09:30:00+00:00')));
      await expectLater(
        a.begin(),
        throwsA(isA<SyncAllowanceError>().having((e) => e.nextAvailableAt, 'next', '2026-11-03T09:30:00.000Z')),
      );
    });

    test('a database that has not been migrated yet means no limit, not a failure', () async {
      final a = allowance(mockClient((_) async => pgError('PGRST202', 'function not found', status: 404)));
      expect((await a.begin()).historyDays, isNull);
      expect((await a.status()).enforced, isFalse);
    });

    test('if the plan cannot be read the sync does not start', () async {
      final a = allowance(mockClient((r) async => r.url.path.endsWith('begin_sync') ? http.Response('', 204) : pgError('XX000', 'boom', status: 500)));
      await expectLater(a.begin(), throwsA(isA<SyncException>().having((e) => e.message, 'message', contains('Could not read the sync allowance'))));
    });

    test('other begin failures stop the sync with a message', () async {
      final a = allowance(mockClient((_) async => pgError('XX000', 'boom', status: 500)));
      await expectLater(a.begin(), throwsA(isA<SyncException>().having((e) => e.message, 'message', 'Could not start the sync: boom')));
    });

    test('status reads a single object as well as a one-row list, and an empty answer as unlimited', () async {
      expect((await allowance(mockClient((_) async => jsonResponse(row(next: '2026-11-03T00:00:00Z')))).status()).nextAvailableAt, '2026-11-03T00:00:00Z');
      expect((await allowance(mockClient((_) async => jsonResponse([row(ends: '2026-10-10T00:00:00Z')]))).status()).windowEndsAt, '2026-10-10T00:00:00Z');
      expect((await allowance(mockClient((_) async => jsonResponse([]))).status()).enforced, isFalse);
    });
  });
}
