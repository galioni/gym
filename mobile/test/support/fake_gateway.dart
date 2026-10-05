import 'dart:convert';

import 'package:daily_grind/data/row_gateway.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/sync/sync_errors.dart';

Json _copy(Json row) => (jsonDecode(jsonEncode(row)) as Map).cast<String, Object?>();

/// In-memory stand-in for the database as seen by one signed-in user (Dart twin of the web suite's
/// `FakeGateway`), with optional per-table caps that behave like the row-limit trigger: a statement that would
/// leave more live rows than the cap is refused whole; updating an existing row never counts.
class FakeGateway implements RowGateway {
  FakeGateway(this._nowMs);

  final int Function() _nowMs;

  final tables = {for (final t in UserTable.values) t: <String, Json>{}};
  final upserted = {for (final t in UserTable.values) t: 0};
  final calls = <String>[];
  int rowsRead = 0;
  int _clock = 0;

  /// Per-table cap on live rows (an unset table is unlimited).
  final caps = <UserTable, int>{};

  /// When set, every write is refused with this error (reads still work).
  Exception? refuseWrites;

  /// When set, reads wait for it (a test holds a sync in the middle of running).
  Future<void>? hold;

  String _stamp() => DateTime.fromMillisecondsSinceEpoch(_nowMs() + ++_clock, isUtc: true).toIso8601String();

  static String _key(UserTable table, Json row) => switch (table) {
        UserTable.workoutDays => row['day'] as String,
        UserTable.templates => row['session_type'] as String,
        UserTable.userSettings => row['user_id'] as String,
        UserTable.plans => row['id'] as String,
      };

  @override
  Future<String> requireUserId() async => 'user-1';

  @override
  Future<List<Json>> selectAll(UserTable table) async {
    calls.add('selectAll:${table.name}');
    await hold;
    final rows = [for (final r in tables[table]!.values) _copy(r)];
    rowsRead += rows.length;
    return rows;
  }

  @override
  Future<List<Json>> selectChangedSince(UserTable table, String since) async {
    calls.add('selectChangedSince:${table.name}');
    final rows = [
      for (final r in tables[table]!.values)
        if (((r['updated_at'] as String?) ?? '').compareTo(since) >= 0) _copy(r),
    ];
    rowsRead += rows.length;
    return rows;
  }

  @override
  Future<void> upsertRows(UserTable table, List<Json> rows) async {
    if (refuseWrites != null) throw refuseWrites!;
    final cap = caps[table];
    if (cap != null) {
      final incoming = {for (final r in rows) _key(table, r)};
      final surviving =
          tables[table]!.entries.where((e) => e.value['deleted_at'] == null && !incoming.contains(e.key)).length;
      if (surviving + incoming.length > cap) throw CloudLimitError(table.name, 'row limit reached for ${table.name}');
    }
    for (final r in rows) {
      tables[table]![_key(table, r)] = {..._copy(r), 'updated_at': _stamp()};
      upserted[table] = upserted[table]! + 1;
    }
  }

  // Mirrors the database: the deleted_hash comes from the client, and the trigger blanks the content.
  @override
  Future<void> markDaysDeleted(Map<String, String> days) async {
    if (refuseWrites != null) throw refuseWrites!;
    for (final e in days.entries) {
      final row = tables[UserTable.workoutDays]![e.key];
      if (row != null && row['deleted_at'] == null) {
        row.addAll({
          'updated_at': _stamp(),
          'deleted_at': DateTime.fromMillisecondsSinceEpoch(_nowMs(), isUtc: true).toIso8601String(),
          'deleted_hash': e.value,
          'warmup': <Object?>[],
          'main': <Object?>[],
          'warmup_notes': '',
          'main_notes': '',
          'check_notes': '',
          'weight': '',
          'warmup_timer_ms': 0,
          'main_timer_ms': 0,
        });
      }
    }
  }

  @override
  Future<void> deleteMissing(UserTable table, List<String> keep) async {
    if (refuseWrites != null) throw refuseWrites!;
    tables[table]!.removeWhere((key, _) => !keep.contains(key));
  }
}
