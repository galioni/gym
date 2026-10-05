import 'dart:convert';

import 'package:daily_grind/data/repositories.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/rules.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/sync/day_hash.dart';
import 'package:daily_grind/sync/sync_types.dart';

/// Local storage doubles with the same semantics as the web suite's (`syncDevice.testSupport.ts`): JSON on
/// "disk", sanitised when read, tombstones cleared the way the real local repositories clear them. The sync
/// contract replays against these so a difference is a difference in the sync engine, not in the storage.
Map<String, DayData> _cloneDays(Map<String, DayData> d) => {
      for (final e in d.entries) e.key: DayData.fromJson((jsonDecode(jsonEncode(e.value.toJson())) as Map).cast<String, Object?>()),
    };

class LocalDays implements WorkoutDataRepository {
  LocalDays(this._now);

  final DateTime Function() _now;
  Map<String, DayData> data = {};
  final tombstones = <String, String>{};

  String _stamp() => _now().toUtc().toIso8601String();

  @override
  Future<Map<String, DayData>> readAll() async => data;

  @override
  Future<void> writeAll(Map<String, DayData> next) =>
      writeSnapshot(WorkoutDataSnapshot(version: 1, updatedAt: _stamp(), data: next));

  @override
  Future<WorkoutDataSnapshot?> readSnapshot() async => WorkoutDataSnapshot(
        version: 1,
        updatedAt: _stamp(),
        data: sanitizeDayDataRecord({for (final e in data.entries) e.key: e.value.toJson()}),
        deletedDays: {...tombstones},
      );

  @override
  Future<void> writeSnapshot(WorkoutDataSnapshot next) async {
    data = _cloneDays(next.data);
    for (final date in data.keys) {
      tombstones.remove(date);
    }
    final keep = next.deletedDays;
    if (keep != null) {
      for (final date in tombstones.keys.toList()) {
        if (!keep.containsKey(date)) tombstones.remove(date);
      }
    }
  }

  @override
  Future<void> recordDeletion(String date, DayData day) async {
    tombstones[date] = dayContentHash(sanitizeDayData(day.toJson(), date));
  }

  void userDeletes(String date) {
    // Like the real local repository: the tombstone is the hash of the sanitised day.
    tombstones[date] = dayContentHash(sanitizeDayData(data[date]!.toJson(), date));
    data.remove(date);
  }
}

class LocalTemplates implements TemplateRepository {
  LocalTemplates(this._now);

  final DateTime Function() _now;
  TemplateSnapshot? snapshot;

  void set(Templates data) {
    snapshot = TemplateSnapshot(
      version: 1,
      updatedAt: _now().toUtc().toIso8601String(),
      data: sanitizeTemplates(jsonDecode(jsonEncode(templatesToJson(data)))),
    );
  }

  Templates get data => snapshot == null ? {} : sanitizeTemplates(templatesToJson(snapshot!.data));

  @override
  Future<Templates?> readTemplates() async => snapshot == null ? null : data;

  @override
  Future<void> writeTemplates(Templates templates) async {}

  @override
  Future<TemplateSnapshot?> readSnapshot() async =>
      snapshot == null ? null : TemplateSnapshot(version: snapshot!.version, updatedAt: snapshot!.updatedAt, data: data);

  @override
  Future<void> writeSnapshot(TemplateSnapshot next) async {
    snapshot = TemplateSnapshot(
      version: next.version,
      updatedAt: next.updatedAt,
      data: Map.of(next.data),
    );
  }
}

class LocalPlans implements PlansRepository {
  PlansSnapshot? snapshot;

  @override
  Future<PlansSnapshot?> readSnapshot() async => snapshot;

  @override
  Future<void> writeSnapshot(PlansSnapshot next) async => snapshot = next;

  @override
  Future<List<Plan>> readPlans() async => snapshot?.data ?? [];

  @override
  Future<void> writePlans(List<Plan> plans) async {}

  @override
  Future<String?> readActivePlanId() async => null;

  @override
  Future<void> writeActivePlanId(String? id) async {}
}

class LocalSettings implements AccountSettingsRepository {
  LocalSettings(this._now);

  final DateTime Function() _now;
  SyncedSettings data = const SyncedSettings();

  @override
  Future<SettingsSnapshot?> readSnapshot() async =>
      SettingsSnapshot(version: 1, updatedAt: _now().toUtc().toIso8601String(), data: data);

  @override
  Future<void> writeSnapshot(SettingsSnapshot next) async => data = next.data;
}

class SyncSettingsMemory implements SyncSettingsRepository {
  SyncSettings settings = const SyncSettings();
  SyncBase base = SyncBase.empty;
  List<RestorePoint> points = [];

  @override
  Future<SyncSettings> readSettings() async => settings;

  @override
  Future<void> writeSettings(SyncSettings s) async => settings = s;

  @override
  Future<SyncBase> readSyncBase() async => base;

  @override
  Future<void> writeSyncBase(SyncBase b) async => base = b;

  @override
  Future<List<RestorePoint>> readRestorePoints() async =>
      [for (final p in points) (jsonDecode(jsonEncode(p)) as Map).cast<String, Object?>()];

  @override
  Future<void> writeRestorePoints(List<RestorePoint> next) async =>
      points = [for (final p in next) (jsonDecode(jsonEncode(p)) as Map).cast<String, Object?>()];
}
