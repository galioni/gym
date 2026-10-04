/// Storage boundaries, mirroring `interfaces/*` in the web app. The sync engine and UI depend on these;
/// the SQLite implementations live in `sqlite_repositories.dart`, and a Postgres-backed set will implement
/// the same contracts for the cloud side.
library;

import '../domain/models.dart';
import '../domain/templates.dart';
import '../sync/sync_types.dart';

abstract interface class WorkoutDataRepository {
  Future<Map<String, DayData>> readAll();
  Future<void> writeAll(Map<String, DayData> data);
  Future<WorkoutDataSnapshot?> readSnapshot();
  Future<void> writeSnapshot(WorkoutDataSnapshot snapshot);

  /// Records that the user deleted this day so sync can propagate the deletion instead of restoring it.
  /// Only meaningful for the local repository; cloud repositories receive deletions through [writeSnapshot].
  Future<void> recordDeletion(String date, DayData day);
}

/// What the day tracker needs from local storage: the whole history once, then one day at a time. Writing a single
/// day touches a single row, where the snapshot API above rewrites the history (fine for sync, too heavy for every tick of
/// a checkbox on an account with thousands of days).
abstract interface class WorkoutDayStore {
  Future<Map<String, DayData>> readAll();

  /// Stores [day] (sanitised like any stored value). A day that is present again is no longer deleted.
  Future<void> saveDay(DayData day);

  /// Deletes [day] and records a tombstone with its hash, in one step, so sync deletes it everywhere instead of
  /// restoring it from the cloud.
  Future<void> removeDay(String date, DayData day);
}

abstract interface class TemplateRepository {
  Future<Templates?> readTemplates();
  Future<void> writeTemplates(Templates templates);
  Future<TemplateSnapshot?> readSnapshot();
  Future<void> writeSnapshot(TemplateSnapshot snapshot);
}

abstract interface class PlansRepository {
  Future<List<Plan>> readPlans();
  Future<void> writePlans(List<Plan> plans);
  Future<String?> readActivePlanId();
  Future<void> writeActivePlanId(String? id);
  Future<PlansSnapshot?> readSnapshot();
  Future<void> writeSnapshot(PlansSnapshot snapshot);
}

/// Preferences that follow the account across devices (active plan, plan params and meta).
abstract interface class AccountSettingsRepository {
  Future<SettingsSnapshot?> readSnapshot();
  Future<void> writeSnapshot(SettingsSnapshot snapshot);
}

abstract interface class SyncSettingsRepository {
  Future<SyncSettings> readSettings();
  Future<void> writeSettings(SyncSettings settings);
  Future<SyncBase> readSyncBase();
  Future<void> writeSyncBase(SyncBase base);

  /// Newest first, as written by the sync engine (which decides how many to keep).
  Future<List<RestorePoint>> readRestorePoints();
  Future<void> writeRestorePoints(List<RestorePoint> points);
}
