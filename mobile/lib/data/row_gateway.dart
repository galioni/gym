/// The only operations the cloud repositories need from the database (`RowGateway` in
/// `infrastructure/supabase/PostgrestRowGateway.ts`). Keeping this narrow lets the repository logic (diffing,
/// mapping, limit-aware ordering) be tested against an in-memory fake, and the real adapter against the real
/// stack.
library;

import '../domain/models.dart';

enum UserTable {
  workoutDays('workout_days'),
  templates('templates'),
  plans('plans'),
  userSettings('user_settings');

  const UserTable(this.name);

  /// The Postgres table name.
  final String name;
}

abstract interface class RowGateway {
  /// Id of the signed-in user (also the value of `user_id` on every row written).
  Future<String> requireUserId();

  /// Every row of the signed-in user's table, in a stable order, across pages.
  Future<List<Json>> selectAll(UserTable table);

  /// The rows whose server-owned `updated_at` is at or after [since] (an ISO timestamp), across pages.
  Future<List<Json>> selectChangedSince(UserTable table, String since);

  Future<void> upsertRows(UserTable table, List<Json> rows);

  /// Soft-deletes workout days (sets `deleted_at`, records the hash); a later upsert of the day restores it.
  Future<void> markDaysDeleted(Map<String, String> days);

  /// Removes rows whose key is not in [keep] (whole-collection replace semantics for templates and plans).
  Future<void> deleteMissing(UserTable table, List<String> keep);
}
