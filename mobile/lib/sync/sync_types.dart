/// Snapshot and settings types shared by the repositories and the sync engine; mirror of
/// `application/sync/syncTypes.ts` and `interfaces/sync/SyncSettingsRepository.ts`.
library;

import '../domain/models.dart';
import '../domain/templates.dart';

class WorkoutDataSnapshot implements VersionedSnapshot {
  const WorkoutDataSnapshot({required this.version, required this.updatedAt, required this.data, this.deletedDays});

  @override
  final int version;
  @override
  final String updatedAt;
  final Map<String, DayData> data;

  /// Deleted days: date -> content hash the day had when it was deleted. On reads it lists known tombstones.
  /// On a cloud write it lists dates to soft-delete. On a local write it is the set of tombstones to keep
  /// (null leaves them as they are).
  final Map<String, String>? deletedDays;

  @override
  Object? get dataJson => {for (final e in data.entries) e.key: e.value.toHashJson()};
}

class TemplateSnapshot implements VersionedSnapshot {
  const TemplateSnapshot({required this.version, required this.updatedAt, required this.data});

  @override
  final int version;
  @override
  final String updatedAt;
  final Templates data;

  @override
  Object? get dataJson => templatesToHashJson(data);
}

class PlansSnapshot implements VersionedSnapshot {
  const PlansSnapshot({required this.version, required this.updatedAt, required this.data});

  @override
  final int version;
  @override
  final String updatedAt;
  final List<Plan> data;

  @override
  Object? get dataJson => [for (final p in data) p.toJson()];
}

/// Per-account preferences that follow the user to every device. Plan params and meta stay opaque JSON so
/// nothing the web app stores is lost or re-shaped on the way through. Whether onboarding is done is
/// deliberately not here (see the web type for why).
class SyncedSettings {
  const SyncedSettings({this.activePlanId, this.planParams, this.planMeta});

  final String? activePlanId;
  final Json? planParams;
  final Json? planMeta;
}

class SettingsSnapshot implements VersionedSnapshot {
  const SettingsSnapshot({required this.version, required this.updatedAt, required this.data});

  @override
  final int version;
  @override
  final String updatedAt;
  final SyncedSettings data;

  @override
  Object? get dataJson => syncedSettingsToJson(data);
}

class SyncSettings {
  const SyncSettings({this.lastSyncedAt, this.lastError});

  final String? lastSyncedAt;
  final String? lastError;

  Json toJson() => {'mode': 'cloud', 'lastSyncedAt': lastSyncedAt, 'lastError': lastError};
}

/// What both sides last agreed on, as content hashes; enables three-way merges.
class SyncBase {
  const SyncBase({
    this.days = const {},
    this.templates = const {},
    this.plans = const {},
    this.settings = const {},
  });

  static const empty = SyncBase();

  final Map<String, String> days;
  final Map<String, String> templates;
  final Map<String, String> plans;
  final Map<String, String> settings;

  Json toJson() => {'days': days, 'templates': templates, 'plans': plans, 'settings': settings};
}

/// A pre-sync snapshot of everything, kept so a sync can be rolled back. Held as raw JSON because the sync
/// engine validates it on use (a corrupted one is reported, not trusted).
typedef RestorePoint = Json;

// ---------------------------------------------------------------------------
// Sync results (mirror of `SyncNowResult` and friends in syncTypes.ts)
// ---------------------------------------------------------------------------

enum SyncEntity { workoutData, templates, plans, settings }

enum SyncOutcome { idle, success, error, conflict }

/// Why an [SyncOutcome.error] happened, when the user should be told something specific.
enum SyncFailReason { storageLimit, allowance, otherAccount }

class SyncConflict {
  const SyncConflict({
    required this.entity,
    required this.localUpdatedAt,
    required this.cloudUpdatedAt,
    required this.previewPaths,
  });

  final SyncEntity entity;
  final String localUpdatedAt;
  final String cloudUpdatedAt;
  final List<String> previewPaths;
}

class SyncNowResult {
  const SyncNowResult({
    required this.status,
    this.conflicts = const [],
    required this.message,
    this.appliedToLocal,
    this.reason,
    this.nextAvailableAt,
  });

  final SyncOutcome status;
  final List<SyncConflict> conflicts;
  final String message;

  /// True when this sync changed local data, so in-memory state must be reloaded.
  final bool? appliedToLocal;
  final SyncFailReason? reason;

  /// With [SyncFailReason.allowance]: when the next sync opens (ISO), if the database said.
  final String? nextAvailableAt;
}

/// Common face of the snapshot types: version, timestamp, and the data as JSON (for comparison and storage).
/// Lets the sync engine treat templates, plans and settings alike.
abstract interface class VersionedSnapshot {
  int get version;
  String get updatedAt;
  Object? get dataJson;
}

Json syncedSettingsToJson(SyncedSettings s) =>
    {'activePlanId': s.activePlanId, 'planParams': s.planParams, 'planMeta': s.planMeta};
