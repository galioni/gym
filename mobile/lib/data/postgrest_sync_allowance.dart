/// The Free plan's monthly sync as seen from the app (`PostgrestSyncAllowance` in the web app): `begin_sync()` is
/// called at the start of every sync and `sync_allowance()` tells the screen when the next one opens. Neither can
/// hurt a Pro account or an installation whose database has not been migrated yet: both then behave as "no limit".
library;

import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:postgrest/postgrest.dart';

import '../sync/sync_allowance.dart';
import '../sync/sync_errors.dart';
import 'postgrest_row_gateway.dart' show allowanceUsedCode, unreachable;

/// PostgREST's "function not found": the app can be live before the database migration is.
const functionMissingCode = 'PGRST202';

class PostgrestSyncAllowance implements SyncAllowance {
  PostgrestSyncAllowance(this._rest);

  final PostgrestClient _rest;

  Future<T> _transport<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on TimeoutException {
      throw const SyncException(unreachable);
    } on SocketException {
      throw const SyncException(unreachable);
    } on http.ClientException {
      throw const SyncException(unreachable);
    }
  }

  @override
  Future<SyncGrant> begin() async {
    try {
      await _transport(() => _rest.rpc('begin_sync'));
    } on PostgrestException catch (e) {
      if (e.code == allowanceUsedCode) throw SyncAllowanceError(parseNextAvailable(e.details));
      if (e.code == functionMissingCode) return const SyncGrant();
      throw SyncException('Could not start the sync: ${e.message}');
    }
    // The plan decides what may be uploaded. If it cannot be read the sync does not run: guessing "no limit" could
    // upload days the plan does not keep, and guessing "limited" could hold back days a paying account is entitled to.
    return SyncGrant(historyDays: historyDaysFor(await status()));
  }

  @override
  Future<SyncAllowanceStatus> status() async {
    final Object? data;
    try {
      data = await _transport(() => _rest.rpc('sync_allowance'));
    } on PostgrestException catch (e) {
      if (e.code == functionMissingCode) return SyncAllowanceStatus.unlimited;
      throw SyncException('Could not read the sync allowance: ${e.message}');
    }
    final row = data is List ? (data.isEmpty ? null : data.first) : data;
    if (row is! Map) return SyncAllowanceStatus.unlimited;
    return SyncAllowanceStatus(
      enforced: row['enforced'] == true,
      isPro: row['is_pro'] == true,
      windowEndsAt: row['window_ends_at'] as String?,
      nextAvailableAt: row['next_available_at'] as String?,
    );
  }
}
