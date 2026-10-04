/// SQLite implementations of the repository boundaries, with the same semantics as the web app's
/// localStorage ones (`infrastructure/workout/*`, `infrastructure/sync/LocalStorageSyncSettingsRepository.ts`).
///
/// Differences from the web, all consequences of the storage engine rather than behaviour:
///  * reads do not write back (the web rewrites after migrating; here the sanitised value is returned and the
///    next real write persists it);
///  * a day row that is not valid JSON is skipped, not the whole history reset;
///  * restore points are not size-budgeted (no 5 MB browser quota); the sync engine prunes by count.
library;

import 'dart:convert';

import '../domain/defaults.dart';
import '../domain/models.dart';
import '../domain/rules.dart';
import '../domain/templates.dart';
import '../sync/day_hash.dart';
import '../sync/sync_types.dart';
import 'local_database.dart';
import 'repositories.dart';

typedef Clock = DateTime Function();

String _isoNow(Clock now) => now().toUtc().toIso8601String();

Map<String, String> _stringValues(Object? v) => v is Map
    ? {for (final e in v.entries) if (e.key is String && e.value is String) e.key as String: e.value as String}
    : {};

// Doc keys.
const _workoutMeta = 'workout_meta';
const _templates = 'templates';
const _plans = 'plans';
const _activePlan = 'active_plan';
const _planParams = 'plan_params';
const _planMeta = 'plan_meta';
const _syncSettings = 'sync_settings';
const _syncBase = 'sync_base';

class SqliteWorkoutDataRepository implements WorkoutDataRepository, WorkoutDayStore {
  SqliteWorkoutDataRepository(this._store, {this._now = DateTime.now});

  final LocalDatabase _store;
  final Clock _now;

  Map<String, String> _readTombstones() => {
        for (final r in _store.db.select('SELECT date, hash FROM tombstones')) r['date'] as String: r['hash'] as String,
      };

  @override
  Future<WorkoutDataSnapshot?> readSnapshot() async {
    final meta = _store.readDoc(_workoutMeta);
    if (meta is! Map) return null;
    final raw = <String, Object?>{};
    for (final r in _store.db.select('SELECT date, json FROM days')) {
      try {
        raw[r['date'] as String] = jsonDecode(r['json'] as String);
      } on FormatException {
        // Unreadable row: skip it rather than lose the rest.
      }
    }
    return WorkoutDataSnapshot(
      version: storageSchemaVersion,
      updatedAt: meta['updatedAt'] is String ? meta['updatedAt'] as String : _isoNow(_now),
      data: sanitizeDayDataRecord(raw),
      deletedDays: _readTombstones(),
    );
  }

  @override
  Future<void> writeSnapshot(WorkoutDataSnapshot snapshot) async {
    if (snapshot.version > storageSchemaVersion) {
      throw StateError(
        'Cannot write workout data schema version ${snapshot.version}: app supports up to v$storageSchemaVersion.',
      );
    }
    final data = sanitizeDayDataRecord({for (final e in snapshot.data.entries) e.key: e.value.toJson()});
    final db = _store.db;

    _store.transaction(() {
      final existing = {
        for (final r in db.select('SELECT date, json FROM days')) r['date'] as String: r['json'] as String,
      };
      for (final date in existing.keys) {
        if (!data.containsKey(date)) db.execute('DELETE FROM days WHERE date = ?', [date]);
      }
      for (final e in data.entries) {
        final json = jsonEncode(e.value.toJson());
        if (existing[e.key] != json) {
          db.execute('INSERT OR REPLACE INTO days (date, json) VALUES (?, ?)', [e.key, json]);
        }
      }
      _store.writeDoc(_workoutMeta, {'version': snapshot.version, 'updatedAt': snapshot.updatedAt});

      // A day that is present again is no longer deleted; sync may also pass the exact set of tombstones to keep.
      final keep = snapshot.deletedDays;
      for (final date in _readTombstones().keys) {
        if (data.containsKey(date) || (keep != null && !keep.containsKey(date))) {
          db.execute('DELETE FROM tombstones WHERE date = ?', [date]);
        }
      }
    });
  }

  @override
  Future<void> recordDeletion(String date, DayData day) async {
    final hash = dayContentHash(sanitizeDayData(day.toJson(), date));
    _store.db.execute('INSERT OR REPLACE INTO tombstones (date, hash) VALUES (?, ?)', [date, hash]);
  }

  @override
  Future<void> saveDay(DayData day) async {
    final stored = sanitizeDayData(day.toJson(), day.date);
    _store.transaction(() {
      _store.db.execute('INSERT OR REPLACE INTO days (date, json) VALUES (?, ?)', [day.date, jsonEncode(stored.toJson())]);
      _store.db.execute('DELETE FROM tombstones WHERE date = ?', [day.date]);
      _touch();
    });
  }

  @override
  Future<void> removeDay(String date, DayData day) async {
    final hash = dayContentHash(sanitizeDayData(day.toJson(), date));
    _store.transaction(() {
      _store.db.execute('INSERT OR REPLACE INTO tombstones (date, hash) VALUES (?, ?)', [date, hash]);
      _store.db.execute('DELETE FROM days WHERE date = ?', [date]);
      _touch();
    });
  }

  /// Records that the history changed now (and that a history exists, so reads stop returning "nothing stored").
  void _touch() => _store.writeDoc(_workoutMeta, {'version': storageSchemaVersion, 'updatedAt': _isoNow(_now)});

  @override
  Future<Map<String, DayData>> readAll() async => (await readSnapshot())?.data ?? {};

  @override
  Future<void> writeAll(Map<String, DayData> data) => writeSnapshot(
        WorkoutDataSnapshot(version: storageSchemaVersion, updatedAt: _isoNow(_now), data: data),
      );
}

class SqliteTemplateRepository implements TemplateRepository {
  SqliteTemplateRepository(this._store, {this._now = DateTime.now, this._idGen = generateId});

  final IdGenerator _idGen;

  final LocalDatabase _store;
  final Clock _now;

  @override
  Future<TemplateSnapshot?> readSnapshot() async {
    final raw = _store.readDoc(_templates);
    return raw == null ? null : migrateRawTemplateSnapshot(raw, now: _now());
  }

  @override
  Future<void> writeSnapshot(TemplateSnapshot snapshot) async {
    if (snapshot.version > templateSchemaVersion) {
      throw StateError(
        'Cannot write templates schema version ${snapshot.version}: app supports up to v$templateSchemaVersion.',
      );
    }
    _store.writeDoc(_templates, {
      'version': snapshot.version,
      'updatedAt': snapshot.updatedAt,
      'templates': templatesToJson(_withRowIds(sanitizeTemplates(templatesToJson(snapshot.data)))),
    });
  }

  /// Gives every stored row an id. The sanitiser refills an emptied built-in section from defaults that have none, and a row
  /// without an id gets a new random one on every read, so the template would look changed to sync on every run. (The web
  /// app has the same quirk and avoids it only because its editor always saves ids.) Stored ids make reads stable.
  Templates _withRowIds(Templates templates) {
    List<TemplateRow> withIds(List<TemplateRow> rows) => [
          for (final r in rows)
            r.id != null
                ? r
                : TemplateRow(
                    id: _idGen(),
                    text: r.text,
                    target: r.target,
                    equipment: r.equipment,
                    description: r.description,
                    videoUrl: r.videoUrl,
                    explicitKeys: r.explicitKeys,
                  ),
        ];
    return {
      for (final e in templates.entries)
        e.key: TemplateData(
          source: e.value.source,
          label: e.value.label,
          focus: e.value.focus,
          videoUrl: e.value.videoUrl,
          warmup: withIds(e.value.warmup),
          main: withIds(e.value.main),
          explicitKeys: e.value.explicitKeys,
        ),
    };
  }

  @override
  Future<Templates?> readTemplates() async => (await readSnapshot())?.data;

  @override
  Future<void> writeTemplates(Templates templates) => writeSnapshot(
        TemplateSnapshot(version: templateSchemaVersion, updatedAt: _isoNow(_now), data: templates),
      );
}

class SqlitePlansRepository implements PlansRepository {
  SqlitePlansRepository(this._store, {this._now = DateTime.now});

  final LocalDatabase _store;
  final Clock _now;

  @override
  Future<PlansSnapshot?> readSnapshot() async {
    final raw = _store.readDoc(_plans);
    return raw == null ? null : migrateRawPlansSnapshot(raw, now: _now());
  }

  @override
  Future<void> writeSnapshot(PlansSnapshot snapshot) async {
    if (snapshot.version > plansSchemaVersion) {
      throw StateError(
        'Cannot write plans schema version ${snapshot.version}: app supports up to v$plansSchemaVersion.',
      );
    }
    _store.writeDoc(_plans, {
      'version': snapshot.version,
      'updatedAt': snapshot.updatedAt,
      'plans': [for (final p in snapshot.data) p.toJson()],
    });
  }

  @override
  Future<List<Plan>> readPlans() async => (await readSnapshot())?.data ?? [];

  @override
  Future<void> writePlans(List<Plan> plans) =>
      writeSnapshot(PlansSnapshot(version: plansSchemaVersion, updatedAt: _isoNow(_now), data: plans));

  @override
  Future<String?> readActivePlanId() async {
    final v = _store.readDoc(_activePlan);
    return v is String ? v : null;
  }

  @override
  Future<void> writeActivePlanId(String? id) async =>
      id == null ? _store.deleteDoc(_activePlan) : _store.writeDoc(_activePlan, id);
}

/// The account preferences that live in separate documents (active plan, plan params, plan meta), presented as
/// one snapshot so they can be synced. They carry no timestamp of their own: `updatedAt` is "now".
class SqliteAccountSettingsRepository implements AccountSettingsRepository {
  SqliteAccountSettingsRepository(this._store, {this._now = DateTime.now});

  final LocalDatabase _store;
  final Clock _now;

  Json? _object(String key) {
    final v = _store.readDoc(key);
    return v is Map ? v.cast<String, Object?>() : null;
  }

  @override
  Future<SettingsSnapshot> readSnapshot() async {
    final active = _store.readDoc(_activePlan);
    return SettingsSnapshot(
      version: 1,
      updatedAt: _isoNow(_now),
      data: SyncedSettings(
        activePlanId: active is String && active.isNotEmpty ? active : null,
        planParams: _object(_planParams),
        planMeta: _object(_planMeta),
      ),
    );
  }

  @override
  Future<void> writeSnapshot(SettingsSnapshot snapshot) async {
    final s = snapshot.data;
    _store.transaction(() {
      void set(String key, Object? value) => value == null ? _store.deleteDoc(key) : _store.writeDoc(key, value);
      set(_activePlan, s.activePlanId);
      set(_planParams, s.planParams);
      set(_planMeta, s.planMeta);
    });
  }
}

class SqliteSyncSettingsRepository implements SyncSettingsRepository {
  SqliteSyncSettingsRepository(this._store);

  final LocalDatabase _store;

  @override
  Future<SyncSettings> readSettings() async {
    final v = _store.readDoc(_syncSettings);
    if (v is! Map) return const SyncSettings();
    return SyncSettings(
      lastSyncedAt: v['lastSyncedAt'] is String ? v['lastSyncedAt'] as String : null,
      lastError: v['lastError'] is String ? v['lastError'] as String : null,
    );
  }

  @override
  Future<void> writeSettings(SyncSettings settings) async => _store.writeDoc(_syncSettings, settings.toJson());

  @override
  Future<SyncBase> readSyncBase() async {
    final v = _store.readDoc(_syncBase);
    if (v is! Map) return SyncBase.empty;
    return SyncBase(
      days: _stringValues(v['days']),
      templates: _stringValues(v['templates']),
      plans: _stringValues(v['plans']),
      settings: _stringValues(v['settings']),
    );
  }

  @override
  Future<void> writeSyncBase(SyncBase base) async => _store.writeDoc(_syncBase, base.toJson());

  @override
  Future<List<RestorePoint>> readRestorePoints() async {
    final out = <RestorePoint>[];
    for (final r in _store.db.select('SELECT json FROM restore_points ORDER BY position')) {
      try {
        final v = jsonDecode(r['json'] as String);
        if (v is Map) out.add(v.cast<String, Object?>());
      } on FormatException {
        // Skip an unreadable point; the others are still usable.
      }
    }
    return out;
  }

  @override
  Future<void> writeRestorePoints(List<RestorePoint> points) async {
    final db = _store.db;
    _store.transaction(() {
      db.execute('DELETE FROM restore_points');
      for (var i = 0; i < points.length; i++) {
        db.execute('INSERT INTO restore_points (position, json) VALUES (?, ?)', [i, jsonEncode(points[i])]);
      }
    });
  }
}
