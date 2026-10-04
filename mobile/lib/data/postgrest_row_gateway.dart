/// The real [RowGateway]: the user's own rows over PostgREST (`PostgrestRowGateway` in the web app). The client
/// must send the signed-in user's token (supabase_flutter's `client.rest` does), because that is what row level
/// security evaluates; nothing here is trusted to scope a query to the user.
library;

import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:postgrest/postgrest.dart';

import '../domain/models.dart';
import '../sync/sync_allowance.dart';
import '../sync/sync_errors.dart';
import 'row_gateway.dart';

// Stable total order so pages never overlap or skip rows.
const _order = {
  UserTable.workoutDays: ['day'],
  UserTable.templates: ['position', 'session_type'],
  UserTable.plans: ['position', 'id'],
  UserTable.userSettings: ['user_id'],
};
const _key = {UserTable.templates: 'session_type', UserTable.plans: 'id'};
const _conflict = {
  UserTable.workoutDays: 'user_id,day',
  UserTable.templates: 'user_id,session_type',
  UserTable.plans: 'user_id,id',
  UserTable.userSettings: 'user_id',
};

// Hosted Supabase caps a response at 1000 rows by default, so reads page and writes batch below that.
const pageSize = 1000;
const writeBatch = 200;

/// SQLSTATE the database raises when an account reaches a row limit (PostgREST returns it as HTTP 422).
const limitReachedCode = 'PT422';

/// ... and when a Free account writes outside its monthly sync window (HTTP 423).
const allowanceUsedCode = 'PT423';

/// ... and when a Free account writes a workout day older than the window the cloud keeps (HTTP 424).
const historyWindowCode = 'PT424';

/// Turns a failed write into what the sync engine understands: a refusal it can carry on past (a limit, the
/// allowance), or a plain failure with a message to show.
Exception writeError(UserTable table, String action, PostgrestException e) {
  if (e.code == allowanceUsedCode) return SyncAllowanceError(parseNextAvailable(e.details));
  if (e.code == limitReachedCode) return CloudLimitError(table.name, describeLimit(table.name));
  if (e.code == historyWindowCode) return SyncException(describeHistoryWindow());
  return SyncException('Database $action failed (${table.name}): ${e.message}');
}

/// The message for a request that never got an answer.
const unreachable = 'Could not reach the server. Check your connection and try again.';

class PostgrestRowGateway implements RowGateway {
  PostgrestRowGateway(this._rest, {required this._currentUserId});

  final PostgrestClient _rest;
  final String? Function() _currentUserId;

  @override
  Future<String> requireUserId() async {
    final id = _currentUserId();
    if (id == null) throw const SyncException('Missing authenticated session. Sign in again and retry sync.');
    return id;
  }

  /// Runs [body], turning transport failures into a [SyncException] and database errors via [onDatabaseError].
  Future<T> _run<T>(Future<T> Function() body, Exception Function(PostgrestException e) onDatabaseError) async {
    try {
      return await body();
    } on PostgrestException catch (e) {
      throw onDatabaseError(e);
    } on TimeoutException {
      throw const SyncException(unreachable);
    } on SocketException {
      throw const SyncException(unreachable);
    } on http.ClientException {
      throw const SyncException(unreachable);
    }
  }

  @override
  Future<List<Json>> selectAll(UserTable table) => _selectPages(table, null);

  @override
  Future<List<Json>> selectChangedSince(UserTable table, String since) => _selectPages(table, since);

  Future<List<Json>> _selectPages(UserTable table, String? since) async {
    final rows = <Json>[];
    for (var from = 0;; from += pageSize) {
      final page = await _run(() async {
        var filter = _rest.from(table.name).select();
        if (since != null) filter = filter.gte('updated_at', since);
        PostgrestTransformBuilder<List<Map<String, dynamic>>> query = filter;
        for (final column in _order[table]!) {
          query = query.order(column, ascending: true);
        }
        return query.range(from, from + pageSize - 1);
      }, (e) => SyncException('Database read failed (${table.name}): ${e.message}'));
      rows.addAll(page.map((r) => r.cast<String, Object?>()));
      if (page.length < pageSize) return rows;
    }
  }

  @override
  Future<void> upsertRows(UserTable table, List<Json> rows) async {
    for (var i = 0; i < rows.length; i += writeBatch) {
      final batch = rows.sublist(i, i + writeBatch < rows.length ? i + writeBatch : rows.length);
      await _run(
        () => _rest.from(table.name).upsert(batch, onConflict: _conflict[table]),
        (e) => writeError(table, 'write', e),
      );
    }
  }

  @override
  Future<void> markDaysDeleted(Map<String, String> days) async {
    final userId = await requireUserId();
    // The database blanks a deleted day's content, so each day carries the hash its content had. Days that share
    // a hash (typically a few identical empty days) go in one request.
    final byHash = <String, List<String>>{};
    for (final e in days.entries) {
      byHash.putIfAbsent(e.value, () => []).add(e.key);
    }
    final deletedAt = DateTime.now().toUtc().toIso8601String();
    for (final e in byHash.entries) {
      for (var i = 0; i < e.value.length; i += writeBatch) {
        final batch = e.value.sublist(i, i + writeBatch < e.value.length ? i + writeBatch : e.value.length);
        await _run(
          () => _rest
              .from('workout_days')
              .update({'deleted_at': deletedAt, 'deleted_hash': e.key})
              .eq('user_id', userId)
              .inFilter('day', batch)
              .isFilter('deleted_at', null),
          (err) => SyncException('Database delete failed (workout_days): ${err.message}'),
        );
      }
    }
  }

  @override
  Future<void> deleteMissing(UserTable table, List<String> keep) async {
    final userId = await requireUserId();
    final column = _key[table]!;
    final existing = await _run(
      () => _rest.from(table.name).select(column).eq('user_id', userId),
      (e) => SyncException('Database read failed (${table.name}): ${e.message}'),
    );
    final keepSet = keep.toSet();
    final stale = [for (final r in existing) r[column] as String].where((k) => !keepSet.contains(k)).toList();
    for (var i = 0; i < stale.length; i += writeBatch) {
      final batch = stale.sublist(i, i + writeBatch < stale.length ? i + writeBatch : stale.length);
      await _run(
        () => _rest.from(table.name).delete().eq('user_id', userId).inFilter(column, batch),
        (e) => SyncException('Database delete failed (${table.name}): ${e.message}'),
      );
    }
  }
}
