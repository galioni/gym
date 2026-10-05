/// The cloud side of the repository boundaries, over Postgres (`infrastructure/supabase/PostgresRepositories.ts`).
/// Same behaviour as the web adapters, including the order writes are made in so an account limit can never
/// deadlock a sync, and the incremental read of workout days.
library;

import '../domain/defaults.dart';
import '../domain/models.dart';
import '../domain/rules.dart';
import '../domain/templates.dart';
import '../sync/content_hash.dart';
import '../sync/day_hash.dart';
import '../sync/sync_errors.dart';
import '../sync/sync_types.dart';
import 'postgres_rows.dart';
import 'repositories.dart';
import 'row_gateway.dart';

/// Incremental reads of workout days. A signed-in device keeps the rows it has read and, on later syncs, asks
/// only for rows changed since the newest server timestamp it holds, so a sync on a 5,000-day account does not
/// download 5,000 rows.
///
///  * OVERLAP: `updated_at` is the time a write's transaction STARTED. A transaction that started a moment before
///    the cursor can commit after we read, so each request goes back this far and re-reads a few rows.
///  * FULL_READ_EVERY: the server also removes rows (daily purges of old deleted days and of Free-plan history).
///    An incremental read cannot see a removal, so everything is re-read this often, and whenever the signed-in
///    user changes.
/// The copy lives in memory only: opening the app always starts with one full read.
const incrementalOverlap = Duration(minutes: 2);
const fullReadEvery = Duration(minutes: 60);

String _fingerprint(Object? value) => hashString(stableSerialize(value));

/// Writes the changed rows of a collection in an order that an account limit can never deadlock:
///
///  1. edits to rows the cloud already holds. An update adds no row, so it cannot hit a limit;
///  2. deletions, which free room (otherwise someone at the limit who deletes one item and adds another could
///     never sync, because the new item was inserted before the old one was removed);
///  3. new rows, as one batch. If that batch is refused for being over the limit, they are tried one by one in
///     order until the first refusal, so an account with room for three more stores three instead of none.
///
/// If any new row was refused, the limit error is thrown only AFTER the edits, deletions and the rows that fit
/// are saved, so the person is told while nothing else is held back.
Future<void> _writeRespectingLimits({
  required List<Json> rows,
  required bool Function(Json row) exists,
  required Future<void> Function(List<Json> rows) upsert,
  required Future<void> Function() deleteRemoved,
  required void Function(Json row) onWritten,
}) async {
  final edits = rows.where(exists).toList();
  final additions = rows.where((r) => !exists(r)).toList();

  if (edits.isNotEmpty) {
    await upsert(edits);
    edits.forEach(onWritten);
  }
  await deleteRemoved();
  if (additions.isEmpty) return;

  try {
    await upsert(additions);
    additions.forEach(onWritten);
    return;
  } on CloudLimitError catch (e) {
    if (additions.length == 1) rethrow;
    var refusal = e;
    for (final row in additions) {
      try {
        await upsert([row]);
        onWritten(row);
      } on CloudLimitError catch (single) {
        refusal = single;
        break;
      }
    }
    throw refusal;
  }
}

/// Workout days in Postgres (one row per day). Writes upsert only the days that differ from what the last read
/// returned, so a sync touches the rows that changed and the server-owned `updated_at` stays meaningful.
/// Deletions arrive as `snapshot.deletedDays` and become soft deletes.
class PostgresWorkoutDataRepository implements WorkoutDataRepository {
  PostgresWorkoutDataRepository(this._gateway, {this._now = DateTime.now});

  final RowGateway _gateway;
  final DateTime Function() _now;

  var _lastRead = <String, String>{};
  var _copy = <String, Json>{};
  String? _copyOwner;
  String? _cursor;
  DateTime? _fullReadAt;

  /// Every row of the account, from the kept copy brought up to date (or from a full read when that is due).
  Future<List<Json>> _loadRows() async {
    final userId = await _gateway.requireUserId();
    final due = _copyOwner != userId ||
        _cursor == null ||
        _fullReadAt == null ||
        _now().difference(_fullReadAt!) >= fullReadEvery;
    if (due) {
      final rows = await _gateway.selectAll(UserTable.workoutDays);
      _copy = {for (final r in rows) r['day'] as String: r};
      _copyOwner = userId;
      _fullReadAt = _now();
    } else {
      final cursorMs = DateTime.parse(_cursor!).millisecondsSinceEpoch;
      final since = DateTime.fromMillisecondsSinceEpoch(cursorMs - incrementalOverlap.inMilliseconds, isUtc: true)
          .toIso8601String();
      for (final r in await _gateway.selectChangedSince(UserTable.workoutDays, since)) {
        _copy[r['day'] as String] = r;
      }
    }
    final stamps = [for (final r in _copy.values) if (r['updated_at'] is String) r['updated_at'] as String];
    // From the server's own stamps, never this device's clock. Without any stamp there is no cursor, so the
    // next read is full.
    _cursor = stamps.isEmpty ? null : stamps.reduce((a, b) => a.compareTo(b) > 0 ? a : b);
    return [..._copy.values]..sort((a, b) => (a['day'] as String).compareTo(b['day'] as String));
  }

  @override
  Future<WorkoutDataSnapshot?> readSnapshot() async {
    final rows = await _loadRows();
    if (rows.isEmpty) {
      _lastRead = {};
      return null;
    }
    final live = rows.where((r) => r['deleted_at'] == null);
    final deleted = rows.where((r) => r['deleted_at'] != null);

    final data = sanitizeDayDataRecord({for (final r in live) r['day'] as String: rowToRawDay(r)});
    _lastRead = {for (final e in data.entries) e.key: dayContentHash(e.value)};

    return WorkoutDataSnapshot(
      version: storageSchemaVersion,
      updatedAt: latestUpdatedAt(rows, _now),
      data: data,
      // The database blanks a deleted day's content, so the hash it had at deletion is stored on the row. Rows
      // without one (written before that existed) still carry their content and are hashed as before.
      deletedDays: {
        for (final r in deleted)
          r['day'] as String: (r['deleted_hash'] as String?) ??
              dayContentHash(sanitizeDayData(rowToRawDay(r), r['day'] as String)),
      },
    );
  }

  @override
  Future<void> writeSnapshot(WorkoutDataSnapshot snapshot) async {
    final userId = await _gateway.requireUserId();
    final changed = <Json>[];
    for (final e in snapshot.data.entries) {
      if (_lastRead[e.key] == dayContentHash(e.value)) continue;
      final row = dayToRow(userId, e.key, e.value);
      if (row != null) changed.add(row);
    }
    final toDelete = snapshot.deletedDays ?? const <String, String>{};
    await _writeRespectingLimits(
      rows: changed,
      exists: (row) => _lastRead.containsKey(row['day']),
      upsert: (rows) => _gateway.upsertRows(UserTable.workoutDays, rows),
      deleteRemoved: () async {
        if (toDelete.isEmpty) return;
        await _gateway.markDaysDeleted(toDelete);
        for (final date in toDelete.keys) {
          _lastRead.remove(date);
        }
      },
      onWritten: (row) => _lastRead[row['day'] as String] = dayContentHash(snapshot.data[row['day']]!),
    );
  }

  @override
  Future<Map<String, DayData>> readAll() async => (await readSnapshot())?.data ?? {};

  @override
  Future<void> writeAll(Map<String, DayData> data) => writeSnapshot(
        WorkoutDataSnapshot(version: storageSchemaVersion, updatedAt: _now().toUtc().toIso8601String(), data: data),
      );

  @override
  Future<void> recordDeletion(String date, DayData day) =>
      throw UnsupportedError('Deletions reach the cloud through writeSnapshot(deletedDays).');
}

/// Templates in Postgres (one row per session type). A snapshot write replaces the collection: changed sessions
/// are upserted and sessions absent from the snapshot are removed.
class PostgresTemplateRepository implements TemplateRepository {
  PostgresTemplateRepository(this._gateway, {this._now = DateTime.now});

  final RowGateway _gateway;
  final DateTime Function() _now;
  var _lastRead = <String, String>{};

  @override
  Future<TemplateSnapshot?> readSnapshot() async {
    final rows = await _gateway.selectAll(UserTable.templates);
    if (rows.isEmpty) {
      _lastRead = {};
      return null;
    }
    final data = sanitizeTemplates(rowsToRawTemplates([for (final r in rows) if (r['deleted_at'] == null) r]));
    _lastRead = {for (final e in data.entries) e.key: _fingerprint(e.value.toHashJson())};
    return TemplateSnapshot(version: templateSchemaVersion, updatedAt: latestUpdatedAt(rows, _now), data: data);
  }

  @override
  Future<void> writeSnapshot(TemplateSnapshot snapshot) async {
    final userId = await _gateway.requireUserId();
    final rows = templatesToRows(userId, snapshot.data);
    String fp(String key) => _fingerprint(snapshot.data[key]!.toHashJson());
    final changed = [for (final r in rows) if (_lastRead[r['session_type']] != fp(r['session_type'] as String)) r];
    await _writeRespectingLimits(
      rows: changed,
      exists: (row) => _lastRead.containsKey(row['session_type']),
      upsert: (batch) => _gateway.upsertRows(UserTable.templates, batch),
      deleteRemoved: () => _gateway.deleteMissing(UserTable.templates, [for (final r in rows) r['session_type'] as String]),
      onWritten: (row) => _lastRead[row['session_type'] as String] = fp(row['session_type'] as String),
    );
    _lastRead = {for (final r in rows) r['session_type'] as String: fp(r['session_type'] as String)};
  }

  @override
  Future<Templates?> readTemplates() async => (await readSnapshot())?.data;

  @override
  Future<void> writeTemplates(Templates templates) => writeSnapshot(
        TemplateSnapshot(version: templateSchemaVersion, updatedAt: _now().toUtc().toIso8601String(), data: templates),
      );
}

/// Plans in Postgres (one row per plan), replace-the-collection semantics like templates.
class PostgresPlansRepository implements PlansRepository {
  PostgresPlansRepository(this._gateway, {this._now = DateTime.now});

  final RowGateway _gateway;
  final DateTime Function() _now;
  var _lastRead = <String, String>{};

  @override
  Future<PlansSnapshot?> readSnapshot() async {
    final rows = await _gateway.selectAll(UserTable.plans);
    if (rows.isEmpty) {
      _lastRead = {};
      return null;
    }
    final data = rowsToPlans([for (final r in rows) if (r['deleted_at'] == null) r]);
    _lastRead = {for (final p in data) p.id: _fingerprint(p.toJson())};
    return PlansSnapshot(version: plansSchemaVersion, updatedAt: latestUpdatedAt(rows, _now), data: data);
  }

  @override
  Future<void> writeSnapshot(PlansSnapshot snapshot) async {
    final userId = await _gateway.requireUserId();
    final rows = plansToRows(userId, snapshot.data);
    final byId = {for (final p in snapshot.data) p.id: p};
    String fp(String id) => _fingerprint(byId[id]!.toJson());
    final changed = [for (final r in rows) if (_lastRead[r['id']] != fp(r['id'] as String)) r];
    await _writeRespectingLimits(
      rows: changed,
      exists: (row) => _lastRead.containsKey(row['id']),
      upsert: (batch) => _gateway.upsertRows(UserTable.plans, batch),
      deleteRemoved: () => _gateway.deleteMissing(UserTable.plans, [for (final r in rows) r['id'] as String]),
      onWritten: (row) => _lastRead[row['id'] as String] = fp(row['id'] as String),
    );
    _lastRead = {for (final r in rows) r['id'] as String: fp(r['id'] as String)};
  }

  @override
  Future<List<Plan>> readPlans() async => (await readSnapshot())?.data ?? [];

  @override
  Future<void> writePlans(List<Plan> plans) => writeSnapshot(
        PlansSnapshot(version: plansSchemaVersion, updatedAt: _now().toUtc().toIso8601String(), data: plans),
      );

  /// The active plan is a per-device preference and is not synced.
  @override
  Future<String?> readActivePlanId() async => null;

  @override
  Future<void> writeActivePlanId(String? id) async {}
}

int _jsonLength(Object? v) => stableSerialize(v).length;

/// The per-account preferences row (one row per user). Only the columns this repository owns are written, so
/// other columns of `user_settings` (such as the AI provider) are left alone by the upsert.
class PostgresAccountSettingsRepository implements AccountSettingsRepository {
  PostgresAccountSettingsRepository(this._gateway, {this._now = DateTime.now});

  final RowGateway _gateway;
  final DateTime Function() _now;
  String? _lastRead;

  @override
  Future<SettingsSnapshot?> readSnapshot() async {
    final rows = await _gateway.selectAll(UserTable.userSettings);
    if (rows.isEmpty) {
      _lastRead = null;
      return null;
    }
    final row = rows.first;
    Json? object(Object? v) => v is Map ? v.cast<String, Object?>() : null;
    final data = SyncedSettings(
      activePlanId: row['active_plan_id'] as String?,
      planParams: object(row['plan_params']),
      planMeta: object(row['plan_meta']),
    );
    _lastRead = _fingerprint(syncedSettingsToJson(data));
    return SettingsSnapshot(
      version: 1,
      updatedAt: row['updated_at'] as String? ?? _now().toUtc().toIso8601String(),
      data: data,
    );
  }

  @override
  Future<void> writeSnapshot(SettingsSnapshot snapshot) async {
    final fingerprint = _fingerprint(syncedSettingsToJson(snapshot.data));
    if (_lastRead == fingerprint) return;
    final userId = await _gateway.requireUserId();
    final s = snapshot.data;
    // Database CHECK limits: oversized values are dropped rather than failing the whole write.
    await _gateway.upsertRows(UserTable.userSettings, [
      {
        'user_id': userId,
        'active_plan_id': s.activePlanId != null && s.activePlanId!.isNotEmpty && s.activePlanId!.length <= 100 ? s.activePlanId : null,
        'plan_params': s.planParams != null && _jsonLength(s.planParams) <= 10000 ? s.planParams : null,
        'plan_meta': s.planMeta != null && _jsonLength(s.planMeta) <= 20000 ? s.planMeta : null,
      },
    ]);
    _lastRead = fingerprint;
  }
}
