import 'dart:convert';
import 'dart:io';

import 'package:daily_grind/data/row_gateway.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/sync/sync_errors.dart';
import 'package:daily_grind/sync/sync_merge.dart';
import 'package:daily_grind/sync/sync_service.dart';
import 'package:daily_grind/sync/sync_types.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_gateway.dart';
import '../support/sync_device.dart';

/// Replays the scenarios the web app's real SyncService ran (contract/syncScenarios.contract.test.ts) and
/// requires the same result and the same state, for every device and for the cloud, after every step.
typedef M = Map<String, dynamic>;

Object? norm(Object? v) => jsonDecode(jsonEncode(v));

Object? recordResult(SyncNowResult r, {bool ownership = false}) => norm({
      'status': r.status.name,
      'reason': r.reason?.name,
      'message': ownership ? null : r.message,
      'conflicts': [
        for (final c in r.conflicts) {'entity': c.entity.name, 'previewPaths': c.previewPaths},
      ],
      'appliedToLocal': r.appliedToLocal,
      'nextAvailableAt': r.nextAvailableAt,
    });

Object? recordDevice(Device d) => norm({
      'days': {for (final e in d.days.data.entries) e.key: e.value.toJson()},
      'tombstones': d.days.tombstones,
      'templates': d.templates.snapshot == null ? null : templatesToJson(d.templates.snapshot!.data),
      'plans': d.plans.snapshot == null ? null : [for (final p in d.plans.snapshot!.data) p.toJson()],
      'account': syncedSettingsToJson(d.account.data),
      'base': d.settings.base.toJson(),
      'lastError': d.settings.settings.lastError,
      'synced': d.settings.settings.lastSyncedAt != null,
      'restorePoints': [
        for (final p in d.settings.points)
          {'workoutData': p['workoutData'] != null, 'templates': p['templates'] != null, 'plans': p['plans'] != null},
      ],
    });

Object? recordCloud(FakeGateway g) {
  Map<String, Object?> table(UserTable t) {
    final keys = g.tables[t]!.keys.toList()..sort();
    return {
      for (final k in keys)
        k: () {
          final row = {...g.tables[t]![k]!}..remove('updated_at');
          if (!row.containsKey('deleted_at')) return row;
          final deleted = row.remove('deleted_at') != null;
          return {...row, 'deleted': deleted};
        }(),
    };
  }

  return norm({
    'workout_days': table(UserTable.workoutDays),
    'templates': table(UserTable.templates),
    'plans': table(UserTable.plans),
    'user_settings': table(UserTable.userSettings),
    'upserted': {for (final e in g.upserted.entries) e.key.name: e.value},
  });
}

ConflictResolutionMap resolutionOf(Object? raw) => raw == null
    ? const {}
    : {
        for (final e in (raw as M).entries)
          SyncEntity.values.byName(e.key): ConflictResolution.values.byName(e.value as String),
      };

Future<List<Object?>> runScenario(M scenario, int baseMs, int stepMs) async {
  var nowMs = baseMs;
  DateTime clock() => DateTime.fromMillisecondsSinceEpoch(nowMs, isUtc: true);
  final gateway = FakeGateway(() => nowMs);
  final devices = {for (final n in (scenario['devices'] as List).cast<String>()) n: Device(gateway, clock)};
  final records = <Object?>[];

  final steps = (scenario['steps'] as List).cast<M>();
  for (var index = 0; index < steps.length; index++) {
    nowMs = baseMs + (index + 1) * stepMs;
    final step = steps[index];
    final device = step['device'] == null ? null : devices[step['device'] as String];
    Object? result;

    switch (step['op'] as String) {
      case 'days':
        for (final e in (step['set'] as M).entries) {
          if (e.value == null) {
            device!.days.data.remove(e.key);
          } else {
            device!.days.data[e.key] = mkDay(e.key, e.value as String);
          }
        }
      case 'userDeletes':
        device!.days.userDeletes(step['date'] as String);
      case 'templates':
        final next = {...device!.templates.data};
        for (final e in (step['set'] as M).entries) {
          if (e.value == null) {
            next.remove(e.key);
          } else {
            next[e.key] = mkTemplate(e.value as String);
          }
        }
        device.templates.set(next);
      case 'plans':
        final byId = {for (final p in device!.plans.snapshot?.data ?? <Plan>[]) p.id: p};
        for (final e in (step['set'] as M).entries) {
          if (e.value == null) {
            byId.remove(e.key);
          } else {
            byId[e.key] = mkPlan(e.key, e.value as String);
          }
        }
        device.plans.snapshot = PlansSnapshot(version: 1, updatedAt: clock().toIso8601String(), data: byId.values.toList());
      case 'settings':
        final set = step['set'] as M;
        final cur = device!.account.data;
        Json? obj(Object? v) => v == null ? null : (v as Map).cast<String, Object?>();
        device.account.data = SyncedSettings(
          activePlanId: set.containsKey('activePlanId') ? set['activePlanId'] as String? : cur.activePlanId,
          planParams: set.containsKey('planParams') ? obj(set['planParams']) : cur.planParams,
          planMeta: set.containsKey('planMeta') ? obj(set['planMeta']) : cur.planMeta,
        );
      case 'sync' || 'syncByHand' || 'downloadOnly':
        final op = step['op'] as String;
        final out = await device!.service.syncNow(
          resolution: resolutionOf(step['resolution']),
          automatic: op == 'sync' || op == 'downloadOnly',
          downloadOnly: op == 'downloadOnly',
        );
        result = recordResult(out, ownership: device.ownership.value == OwnerStatus.otherAccount);
      case 'gateway':
        if (step['caps'] != null) {
          gateway.caps
            ..clear()
            ..addAll({
              for (final e in (step['caps'] as M).entries)
                UserTable.values.firstWhere((t) => t.name == e.key): e.value as int,
            });
        }
        if (step.containsKey('refuse')) {
          final r = step['refuse'] as M?;
          gateway.refuseWrites = r == null
              ? null
              : r.containsKey('allowance')
                  ? SyncAllowanceError(r['allowance'] as String?)
                  : SyncException(r['error'] as String);
        }
      case 'allowance':
        if (step.containsKey('historyDays')) device!.allowance.historyDays = step['historyDays'] as int?;
        if (step.containsKey('refuse')) {
          final r = step['refuse'] as M?;
          device!.allowance.refuse = r != null;
          device.allowance.refuseNextAvailable = r?['nextAvailableAt'] as String?;
        }
      case 'ownership':
        device!.ownership.value = step['value'] == 'ok' ? OwnerStatus.ok : OwnerStatus.otherAccount;
      case 'rollback':
        final id = device!.settings.points[step['index'] as int]['id'] as String;
        result = recordResult(await device.service.rollbackToRestorePoint(id));
      case 'rollbackRaw':
        final point = device!.settings.points[step['index'] as int];
        point[step['corrupt'] as String] = {'version': 'x'};
        result = recordResult(await device.service.rollbackToRestorePoint(point['id'] as String));
      case 'rollbackUnknown':
        result = recordResult(await device!.service.rollbackToRestorePoint('no-such-id'));
      case 'prune':
        await device!.service.pruneRestorePoints();
      default:
        fail('unknown op ${step['op']}');
    }
    records.add(norm({
      'result': result,
      'devices': {for (final e in devices.entries) e.key: recordDevice(e.value)},
      'cloud': recordCloud(gateway),
    }));
  }
  return records;
}

/// The first place two JSON values differ, as a path with both values; null when equal.
String? firstDiff(Object? actual, Object? expected, [String path = '']) {
  if (actual is Map && expected is Map) {
    for (final k in {...actual.keys, ...expected.keys}) {
      final d = firstDiff(actual[k], expected[k], path.isEmpty ? '$k' : '$path.$k');
      if (d != null) return d;
    }
    return null;
  }
  if (actual is List && expected is List) {
    for (var i = 0; i < (actual.length > expected.length ? actual.length : expected.length); i++) {
      final d = firstDiff(i < actual.length ? actual[i] : '<missing>', i < expected.length ? expected[i] : '<missing>', '$path[$i]');
      if (d != null) return d;
    }
    return null;
  }
  return jsonEncode(actual) == jsonEncode(expected) ? null : '$path: dart=${jsonEncode(actual)} web=${jsonEncode(expected)}';
}

void main() {
  final fixture = jsonDecode(File('../contract/syncScenarios.fixtures.json').readAsStringSync()) as M;
  final baseMs = fixture['baseMs'] as int;
  final stepMs = fixture['stepMs'] as int;

  for (final scenario in (fixture['scenarios'] as List).cast<M>()) {
    test(scenario['name'] as String, () async {
      final actual = await runScenario(scenario, baseMs, stepMs);
      final expected = (scenario['expected'] as List);
      final steps = (scenario['steps'] as List).cast<M>();
      expect(actual.length, expected.length);
      for (var i = 0; i < expected.length; i++) {
        final a = actual[i] as M;
        final e = expected[i] as M;
        final label = 'step $i (${jsonEncode(steps[i])})';
        final diff = firstDiff(a, e);
        if (diff != null) fail('$label\n  first difference at $diff');
      }
    });
  }
}
