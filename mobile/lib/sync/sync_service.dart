/// Port of `application/sync/SyncService.ts`: one sync between this device and the cloud.
///
/// Per entity (workout days, templates, plans, account settings) it does a three-way merge against what both
/// sides last agreed on (the sync base), so an ordinary edit is not mistaken for a conflict. Real conflicts are
/// returned for the user to resolve and nothing is written until they do. Behaviour is pinned against the web
/// service by contract/syncScenarios.fixtures.json.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/repositories.dart';
import '../domain/models.dart';
import 'collections.dart';
import 'content_hash.dart';
import 'diff_paths.dart';
import 'history_limited_cloud.dart';
import 'snapshot_json.dart';
import 'sync_allowance.dart';
import 'sync_errors.dart';
import 'sync_merge.dart';
import 'sync_types.dart';

typedef ConflictResolutionMap = Map<SyncEntity, ConflictResolution>;

/// Whether the data on this device belongs to the signed-in account. Local data is not stored per account, so a
/// device that held another account's data would otherwise upload it to whoever signed in next.
enum OwnerStatus { ok, otherAccount }

abstract interface class SyncOwnership {
  Future<OwnerStatus> check();
}

String _json(Object? v) => stableSerialize(v);

Object? _tombstonesOf(Object? snapshot) => snapshot is WorkoutDataSnapshot ? (snapshot.deletedDays ?? const {}) : const {};

/// One keyed collection synced item by item (templates, plans, account settings). The adapters keep the merge
/// and the write path generic; each entity only says how to read, write and describe its items.
class _CollectionSync {
  _CollectionSync({
    required this.entity,
    required this.baseKey,
    required this.quiet,
    required this.local,
    required this.cloud,
    required this.readLocal,
    required this.readCloud,
    required this.writeLocal,
    required this.writeCloud,
    required this.toCollection,
    required this.fromCollection,
    required this.describeConflicts,
  });

  final SyncEntity entity;
  final String baseKey;

  /// Preferences nobody should be asked about: on a both-changed item this device simply wins.
  final bool quiet;
  final VersionedSnapshot? local;
  final VersionedSnapshot? cloud;
  final Future<VersionedSnapshot?> Function() readLocal;
  final Future<VersionedSnapshot?> Function() readCloud;
  final Future<void> Function(VersionedSnapshot next) writeLocal;
  final Future<void> Function(VersionedSnapshot next) writeCloud;
  final Collection Function(VersionedSnapshot snapshot) toCollection;
  final VersionedSnapshot Function(Collection collection, int version, String updatedAt) fromCollection;
  final List<String> Function(List<String> keys, Collection local, Collection cloud) describeConflicts;
}

class _Run {
  _Run({this.workout, this.templates, this.plans, this.settings});

  /// Local snapshots as read at the start of the run; local writes are skipped if local changed since.
  final WorkoutDataSnapshot? workout;
  final TemplateSnapshot? templates;
  final PlansSnapshot? plans;
  final SettingsSnapshot? settings;

  /// A local write changed data, so in-memory state is stale.
  bool applied = false;
}

class SyncService {
  SyncService({
    required this.settingsRepository,
    required this.localWorkoutRepository,
    required this.localTemplateRepository,
    required this.cloudWorkoutRepository,
    required this.cloudTemplateRepository,
    this.allowance,
    this.ownership,
    this.localPlansRepository,
    this.cloudPlansRepository,
    this.localSettingsRepository,
    this.cloudSettingsRepository,
    this._now = DateTime.now,
  });

  final SyncSettingsRepository settingsRepository;

  /// Asked at the start of every sync; a Free account that has used its monthly sync is refused here.
  final SyncAllowance? allowance;
  final SyncOwnership? ownership;
  final WorkoutDataRepository localWorkoutRepository;
  final TemplateRepository localTemplateRepository;
  final WorkoutDataRepository? cloudWorkoutRepository;
  final TemplateRepository? cloudTemplateRepository;
  final PlansRepository? localPlansRepository;
  final PlansRepository? cloudPlansRepository;
  final AccountSettingsRepository? localSettingsRepository;
  final AccountSettingsRepository? cloudSettingsRepository;
  final DateTime Function() _now;

  Future<SyncNowResult>? _inFlight;

  /// This run only brings the cloud's data to this device; nothing is sent. Every cloud write is held back and
  /// handled like a refusal, so local data and pending deletions are untouched.
  bool _uploadsHeld = false;

  /// For a plan that keeps a limited history in the cloud: the cloud with older days filtered out of every upload.
  WorkoutDataRepository? _limitedCloud;
  _Run _run = _Run();

  String _iso() => _now().toUtc().toIso8601String();

  Future<SyncSettings> getSettings() => settingsRepository.readSettings();

  Future<List<RestorePoint>> getRestorePoints() => settingsRepository.readRestorePoints();

  /// Keeps only the newest restore point.
  Future<void> pruneRestorePoints() async {
    final points = await getRestorePoints();
    if (points.length <= 1) return;
    String created(RestorePoint p) => p['createdAt'] as String? ?? '';
    final newest = points.reduce((latest, p) => created(p).compareTo(created(latest)) > 0 ? p : latest);
    await settingsRepository.writeRestorePoints([newest]);
  }

  Future<SyncNowResult> rollbackToRestorePoint(String id) async {
    final points = await getRestorePoints();
    final target = points.where((p) => p['id'] == id).firstOrNull;
    if (target == null) {
      return const SyncNowResult(status: SyncOutcome.error, message: 'Restore point not found.');
    }
    SyncNowResult corrupted(String what) =>
        SyncNowResult(status: SyncOutcome.error, message: 'Restore point $what data is corrupted.');

    if (_truthy(target['workoutData'])) {
      final snapshot = WorkoutSnapshotJson.tryParse(target['workoutData']);
      if (snapshot == null) return corrupted('workout');
      await localWorkoutRepository.writeSnapshot(snapshot);
    }
    if (_truthy(target['templates'])) {
      final snapshot = TemplateSnapshotJson.tryParse(target['templates']);
      if (snapshot == null) return corrupted('template');
      await localTemplateRepository.writeSnapshot(snapshot);
    }
    if (_truthy(target['plans']) && localPlansRepository != null) {
      final snapshot = PlansSnapshotJson.tryParse(target['plans']);
      if (snapshot == null) return corrupted('plans');
      await localPlansRepository!.writeSnapshot(snapshot);
    }
    return const SyncNowResult(status: SyncOutcome.success, message: 'Rollback completed from restore point.');
  }

  static bool _truthy(Object? v) => v != null && v != false;

  /// Runs one sync. Calls are single-flight: an automatic sync and a manual one never overlap. A call without a
  /// conflict resolution joins the running sync; one with a resolution waits for it, then runs.
  Future<SyncNowResult> syncNow({
    ConflictResolutionMap resolution = const {},
    bool automatic = false,
    bool downloadOnly = false,
  }) async {
    if (ownership != null && await ownership!.check() == OwnerStatus.otherAccount) {
      return const SyncNowResult(
        status: SyncOutcome.error,
        reason: SyncFailReason.otherAccount,
        message: 'This device holds another account\'s data, so nothing was synced. '
            'Choose "Switch to this account" or sign out.',
      );
    }
    final running = _inFlight;
    if (running != null) {
      if (resolution.isEmpty) return running;
      try {
        await running;
      } catch (_) {}
    }
    final next = _runSync(resolution, automatic, downloadOnly);
    _inFlight = next;
    try {
      return await next;
    } finally {
      if (identical(_inFlight, next)) _inFlight = null;
    }
  }

  /// Writes to local storage only if local storage still holds what this run read. If the user edited in the
  /// meantime the write is skipped (their edit is newer than our merge) and the next sync picks it up.
  Future<void> _writeLocal<T extends VersionedSnapshot>({
    required Future<T?> Function() read,
    required Future<void> Function(T next) write,
    required T? expected,
    required T next,
  }) async {
    final current = await read();
    if (_json(current?.dataJson) != _json(expected?.dataJson) ||
        _json(_tombstonesOf(current)) != _json(_tombstonesOf(expected))) {
      return;
    }
    await write(next);
    if (_json(next.dataJson) != _json(expected?.dataJson)) _run.applied = true;
  }

  Future<SyncNowResult> _runSync(ConflictResolutionMap resolution, bool automatic, bool downloadOnly) async {
    _uploadsHeld = downloadOnly;
    final settings = await getSettings();

    final cloudWorkoutRepo = cloudWorkoutRepository;
    final cloudTemplateRepo = cloudTemplateRepository;
    if (cloudWorkoutRepo == null || cloudTemplateRepo == null) {
      const message = 'Cloud sync mode is selected, but cloud repositories are unavailable. Check sync env vars.';
      await settingsRepository.writeSettings(SyncSettings(lastSyncedAt: settings.lastSyncedAt, lastError: message));
      return const SyncNowResult(status: SyncOutcome.error, message: message);
    }

    try {
      // Permission first, before any read: a sync is both directions, so a refusal means nothing is read or written.
      _run = _Run();
      _limitedCloud = null;
      final grant = await allowance?.begin();
      final historyDays = grant?.historyDays;
      if (historyDays != null && historyDays != 0) {
        _limitedCloud = HistoryLimitedCloudWorkout(cloudWorkoutRepo, historyCutoff(historyDays, _now()));
      }

      final base = await settingsRepository.readSyncBase();
      final localWorkout = await localWorkoutRepository.readSnapshot();
      final localTemplates = await localTemplateRepository.readSnapshot();
      final localPlans = await localPlansRepository?.readSnapshot();
      final localAccount = await localSettingsRepository?.readSnapshot();
      final cloudWorkout = await _cloudWorkout().readSnapshot();
      final cloudTemplates = await cloudTemplateRepo.readSnapshot();
      final cloudPlans = await cloudPlansRepository?.readSnapshot();
      final cloudAccount = await cloudSettingsRepository?.readSnapshot();

      _run = _Run(workout: localWorkout, templates: localTemplates, plans: localPlans, settings: localAccount);
      final collections = _buildCollections(
        cloudTemplateRepo: cloudTemplateRepo,
        localTemplates: localTemplates,
        cloudTemplates: cloudTemplates,
        localPlans: localPlans,
        cloudPlans: cloudPlans,
        localAccount: localAccount,
        cloudAccount: cloudAccount,
      );

      // Apply deletions first so a day deleted on one side is not restored from the other by the merge below.
      final deletions = reconcileDeletions(
        localWorkout?.data ?? {},
        localWorkout?.deletedDays ?? {},
        cloudWorkout?.data ?? {},
        cloudWorkout?.deletedDays ?? {},
      );
      final hasDeletions = deletions.deleteInCloud.isNotEmpty || deletions.deleteLocally.isNotEmpty;
      // Merge inputs carry no tombstones: repositories read deletedDays on a write as an instruction (delete
      // these / keep these).
      final localWorkoutMerged = localWorkout == null
          ? null
          : WorkoutDataSnapshot(version: localWorkout.version, updatedAt: localWorkout.updatedAt, data: deletions.local);
      final cloudWorkoutMerged = cloudWorkout == null
          ? null
          : WorkoutDataSnapshot(version: cloudWorkout.version, updatedAt: cloudWorkout.updatedAt, data: deletions.cloud);

      // Three-way decisions: what changed since both sides last agreed (base), not merely "they differ".
      final unresolvedWorkout = localWorkoutMerged != null && cloudWorkoutMerged != null
          ? mergeWorkoutDays(localWorkoutMerged.data, cloudWorkoutMerged.data, base.days)
          : null;
      final previews = [
        for (final c in collections)
          (
            collection: c,
            merge: c.local != null && c.cloud != null
                ? mergeCollection(
                    c.toCollection(c.local!),
                    c.toCollection(c.cloud!),
                    _baseMap(base, c.baseKey),
                    localWinsConflicts: c.quiet,
                  )
                : null,
          ),
      ];

      // A manual sync always takes a restore point (before anything else). Automatic syncs run constantly, so they
      // only snapshot local data when they are about to change something.
      if (!automatic) await _createRestorePoint(localWorkout, localTemplates, localPlans);

      final conflicts = <SyncConflict>[];
      if (localWorkoutMerged != null &&
          cloudWorkoutMerged != null &&
          unresolvedWorkout != null &&
          unresolvedWorkout.conflictKeys.isNotEmpty) {
        // Scope previewPaths to only the truly conflicting dates, not the auto-mergeable ones.
        final previewPaths = [
          for (final key in unresolvedWorkout.conflictKeys)
            ...collectDiffPaths(
              localWorkoutMerged.data[key]?.toHashJson(),
              cloudWorkoutMerged.data[key]?.toHashJson(),
              key,
            ).take(3),
        ].take(12).toList();
        conflicts.add(SyncConflict(
          entity: SyncEntity.workoutData,
          localUpdatedAt: localWorkoutMerged.updatedAt,
          cloudUpdatedAt: cloudWorkoutMerged.updatedAt,
          previewPaths: previewPaths,
        ));
      }
      for (final p in previews) {
        final merge = p.merge;
        if (merge == null || p.collection.quiet || merge.conflictKeys.isEmpty) continue;
        final c = p.collection;
        conflicts.add(SyncConflict(
          entity: c.entity,
          localUpdatedAt: c.local!.updatedAt,
          cloudUpdatedAt: c.cloud!.updatedAt,
          previewPaths: c.describeConflicts(merge.conflictKeys, c.toCollection(c.local!), c.toCollection(c.cloud!)),
        ));
      }

      final unresolved = [for (final c in conflicts) if (!resolution.containsKey(c.entity)) c];
      if (unresolved.isNotEmpty) {
        return SyncNowResult(
          status: SyncOutcome.conflict,
          conflicts: unresolved,
          message: 'Conflicts detected. Choose Keep Local or Keep Cloud.',
        );
      }

      final workoutMerge = localWorkoutMerged != null && cloudWorkoutMerged != null
          ? mergeWorkoutDays(localWorkoutMerged.data, cloudWorkoutMerged.data, base.days, resolution[SyncEntity.workoutData])
          : null;

      if (automatic) {
        final workoutWork = (localWorkoutMerged == null) != (cloudWorkoutMerged == null) ||
            (workoutMerge != null &&
                localWorkoutMerged != null &&
                cloudWorkoutMerged != null &&
                (_json(_daysJson(workoutMerge.merged)) != _json(_daysJson(localWorkoutMerged.data)) ||
                    _json(_daysJson(workoutMerge.merged)) != _json(_daysJson(cloudWorkoutMerged.data))));
        // Restore points cover workouts, templates and plans; a settings-only change does not need one.
        final collectionWork = previews.any((p) {
          final c = p.collection;
          if (c.entity == SyncEntity.settings) return false;
          if ((c.local == null) != (c.cloud == null)) return true;
          final merge = p.merge;
          if (merge == null || c.local == null || c.cloud == null) return false;
          final mergedData = c.fromCollection(merge.merged, c.local!.version, '').dataJson;
          return _json(mergedData) != _json(c.local!.dataJson) || _json(mergedData) != _json(c.cloud!.dataJson);
        });
        if (hasDeletions || workoutWork || collectionWork) {
          await _createRestorePoint(localWorkout, localTemplates, localPlans);
        }
      }

      // Deletions reach the cloud first. They free room, and without that an account at its limit that deletes one
      // day and adds another could never sync: the new day would be refused before the old one was removed.
      await _applyCloudDeletions(deletions, cloudWorkout);

      // An account limit refuses only the NEW items that do not fit. The rest of the run still completes and its
      // result is recorded, so that edits made afterwards are recognised as edits and not as clashes with an unknown
      // ancestor. The limit is reported at the end.
      CloudLimitError? limitError;
      Map<String, DayData> finalDays;
      Map<String, String>? daysBase;
      try {
        finalDays = await _syncWorkoutData(localWorkoutMerged, cloudWorkoutMerged, workoutMerge);
      } on CloudLimitError catch (e) {
        limitError = e;
        finalDays = {};
        daysBase = await _daysBaseAfterPartialWrite(base.days);
      }
      final nextBase = {
        'templates': base.templates,
        'plans': base.plans,
        'settings': base.settings,
      };
      for (final c in collections) {
        try {
          nextBase[c.baseKey] = await _applyCollection(c, _baseMap(base, c.baseKey), resolution[c.entity]);
        } on CloudLimitError catch (e) {
          limitError ??= e;
          nextBase[c.baseKey] = await _collectionBaseAfterPartialWrite(c, _baseMap(base, c.baseKey));
        }
      }
      await _applyLocalDeletions(deletions, localWorkout);

      // Record what both sides now verifiably agree on for the next three-way merge (all of it, or the part that
      // was accepted).
      await settingsRepository.writeSyncBase(SyncBase(
        days: daysBase ?? await _agreedDaysBase(finalDays, base.days),
        templates: nextBase['templates']!,
        plans: nextBase['plans']!,
        settings: nextBase['settings']!,
      ));
      // A hold we asked for is the point of a download-only run, not something to report as a limit.
      if (limitError != null && !_uploadsHeld) throw limitError;

      await settingsRepository.writeSettings(SyncSettings(lastSyncedAt: _iso(), lastError: null));
      return SyncNowResult(status: SyncOutcome.success, message: 'Sync completed.', appliedToLocal: _run.applied);
    } catch (error) {
      // Having used the sync for the period is not a failure: say when the next one opens, and do not record an error.
      if (error is SyncAllowanceError) {
        return SyncNowResult(
          status: SyncOutcome.error,
          message: error.message,
          reason: SyncFailReason.allowance,
          nextAvailableAt: error.nextAvailableAt,
          appliedToLocal: _run.applied ? true : null,
        );
      }
      final message = switch (error) {
        CloudLimitError e => e.message,
        SyncException e => e.message,
        _ => 'Unknown sync error',
      };
      if (error is! CloudLimitError && error is! SyncException) {
        debugPrint('Unexpected sync failure: $error');
      }
      await settingsRepository.writeSettings(SyncSettings(lastSyncedAt: settings.lastSyncedAt, lastError: message));
      return SyncNowResult(
        status: SyncOutcome.error,
        message: message,
        reason: error is CloudLimitError ? SyncFailReason.storageLimit : null,
      );
    }
  }

  static Map<String, String> _baseMap(SyncBase base, String key) => switch (key) {
        'templates' => base.templates,
        'plans' => base.plans,
        _ => base.settings,
      };

  static Object? _daysJson(Map<String, DayData> days) => {for (final e in days.entries) e.key: e.value.toHashJson()};

  List<_CollectionSync> _buildCollections({
    required TemplateRepository cloudTemplateRepo,
    required TemplateSnapshot? localTemplates,
    required TemplateSnapshot? cloudTemplates,
    required PlansSnapshot? localPlans,
    required PlansSnapshot? cloudPlans,
    required SettingsSnapshot? localAccount,
    required SettingsSnapshot? cloudAccount,
  }) {
    final expected = _run;
    final collections = <_CollectionSync>[];

    collections.add(_CollectionSync(
      entity: SyncEntity.templates,
      baseKey: 'templates',
      quiet: false,
      local: localTemplates,
      cloud: cloudTemplates,
      readLocal: localTemplateRepository.readSnapshot,
      readCloud: cloudTemplateRepo.readSnapshot,
      writeLocal: (next) => _writeLocal<TemplateSnapshot>(
        read: localTemplateRepository.readSnapshot,
        write: localTemplateRepository.writeSnapshot,
        expected: expected.templates,
        next: next as TemplateSnapshot,
      ),
      writeCloud: (next) {
        _assertUploadsAllowed();
        return cloudTemplateRepo.writeSnapshot(next as TemplateSnapshot);
      },
      toCollection: (s) => templatesToCollection((s as TemplateSnapshot).data),
      fromCollection: (c, version, updatedAt) =>
          TemplateSnapshot(version: version, updatedAt: updatedAt, data: collectionToTemplates(c)),
      describeConflicts: (keys, local, cloud) => [
        for (final key in keys) ...collectDiffPaths(local.items[key], cloud.items[key], key).take(3),
      ].take(12).toList(),
    ));

    final lPlans = localPlansRepository;
    final cPlans = cloudPlansRepository;
    if (lPlans != null && cPlans != null) {
      collections.add(_CollectionSync(
        entity: SyncEntity.plans,
        baseKey: 'plans',
        quiet: false,
        local: localPlans,
        cloud: cloudPlans,
        readLocal: lPlans.readSnapshot,
        readCloud: cPlans.readSnapshot,
        writeLocal: (next) => _writeLocal<PlansSnapshot>(
          read: lPlans.readSnapshot,
          write: lPlans.writeSnapshot,
          expected: expected.plans,
          next: next as PlansSnapshot,
        ),
        writeCloud: (next) {
          _assertUploadsAllowed();
          return cPlans.writeSnapshot(next as PlansSnapshot);
        },
        toCollection: (s) => plansToCollection((s as PlansSnapshot).data),
        fromCollection: (c, version, updatedAt) =>
            PlansSnapshot(version: version, updatedAt: updatedAt, data: collectionToPlans(c)),
        // Plan ids are opaque, so name the plans that clash.
        describeConflicts: (keys, local, cloud) => [
          for (final key in keys) ((local.items[key] as Map?)?['label'] as String?) ?? key,
        ],
      ));
    }

    final lAccount = localSettingsRepository;
    final cAccount = cloudSettingsRepository;
    if (lAccount != null && cAccount != null) {
      collections.add(_CollectionSync(
        entity: SyncEntity.settings,
        baseKey: 'settings',
        quiet: true,
        local: localAccount,
        cloud: cloudAccount,
        readLocal: lAccount.readSnapshot,
        readCloud: cAccount.readSnapshot,
        writeLocal: (next) => _writeLocal<SettingsSnapshot>(
          read: lAccount.readSnapshot,
          write: lAccount.writeSnapshot,
          expected: expected.settings,
          next: next as SettingsSnapshot,
        ),
        writeCloud: (next) {
          _assertUploadsAllowed();
          return cAccount.writeSnapshot(next as SettingsSnapshot);
        },
        toCollection: (s) => settingsToCollection((s as SettingsSnapshot).data),
        fromCollection: (c, version, updatedAt) =>
            SettingsSnapshot(version: version, updatedAt: updatedAt, data: collectionToSettings(c)),
        describeConflicts: (keys, local, cloud) => keys,
      ));
    }
    return collections;
  }

  /// Syncs one keyed collection item by item and returns the base to store: the items both sides now verifiably
  /// hold identically (see [agreedBase]).
  Future<Map<String, String>> _applyCollection(
    _CollectionSync c,
    Map<String, String> baseMap,
    ConflictResolution? resolution,
  ) async {
    final local = c.local;
    final cloud = c.cloud;
    final Collection finalCollection;

    if (local == null && cloud == null) {
      return {};
    } else if (local != null && cloud == null) {
      await c.writeCloud(local);
      finalCollection = c.toCollection(local);
    } else if (local == null && cloud != null) {
      await c.writeLocal(cloud);
      finalCollection = c.toCollection(cloud);
    } else {
      final l = local!;
      final cl = cloud!;
      final merged = mergeCollection(
        c.toCollection(l),
        c.toCollection(cl),
        baseMap,
        resolution: resolution,
        localWinsConflicts: c.quiet,
      ).merged;
      final mergedSnapshot = c.fromCollection(merged, l.version, _iso());
      // An account limit refuses only new items. What came from other devices still has to reach this one, so the
      // local write goes ahead and the limit is reported afterwards.
      CloudLimitError? refused;
      if (_json(mergedSnapshot.dataJson) != _json(cl.dataJson)) {
        try {
          await c.writeCloud(mergedSnapshot);
        } on CloudLimitError catch (e) {
          refused = e;
        }
      }
      if (_json(mergedSnapshot.dataJson) != _json(l.dataJson)) {
        await c.writeLocal(mergedSnapshot);
      }
      if (refused != null) throw refused;
      finalCollection = merged;
    }

    final localAfter = await c.readLocal();
    return agreedBase(finalCollection, localAfter == null ? null : c.toCollection(localAfter), baseMap);
  }

  /// Finishes deletions after the merge: soft-deletes days in the cloud.
  Future<void> _applyCloudDeletions(DeletionReconciliation deletions, WorkoutDataSnapshot? cloudWorkout) async {
    if (_uploadsHeld) return;
    if (deletions.deleteInCloud.isNotEmpty) {
      await _cloudWorkout().writeSnapshot(WorkoutDataSnapshot(
        version: cloudWorkout?.version ?? 1,
        updatedAt: _iso(),
        data: deletions.cloud,
        deletedDays: deletions.deleteInCloud,
      ));
    }
  }

  /// The local half of finishing deletions: removes days deleted elsewhere and clears the tombstones that are
  /// settled (every one is, by now: applied, moot, or overridden by a newer edit).
  Future<void> _applyLocalDeletions(DeletionReconciliation deletions, WorkoutDataSnapshot? localWorkout) async {
    final hadTombstones = (localWorkout?.deletedDays ?? const {}).isNotEmpty;
    if (deletions.deleteLocally.isEmpty && !hadTombstones) return;
    // Read-then-write with no network in between, so no extra conflict guard is needed here.
    final current = await localWorkoutRepository.readSnapshot();
    if (current == null) return;
    final data = {...current.data};
    for (final date in deletions.deleteLocally) {
      data.remove(date);
    }
    // A deletion this device made is only settled once the cloud has it. While uploads are held it has not, so
    // keep the tombstones.
    await localWorkoutRepository.writeSnapshot(WorkoutDataSnapshot(
      version: current.version,
      updatedAt: current.updatedAt,
      data: data,
      deletedDays: _uploadsHeld ? (current.deletedDays ?? {}) : {},
    ));
    if (deletions.deleteLocally.isNotEmpty) _run.applied = true;
  }

  /// The cloud workout repository for this run: limited to the plan's history window when it has one.
  WorkoutDataRepository _cloudWorkout() {
    final cloud = _limitedCloud ?? cloudWorkoutRepository;
    if (cloud == null) throw const SyncException('Cloud sync is not configured.');
    return cloud;
  }

  /// Every write to the cloud goes through here first.
  void _assertUploadsAllowed() {
    if (_uploadsHeld) throw SyncAllowanceError(null, 'Uploads are held back for this sync.');
  }

  /// The days base after a normal run: the merged days this device now verifiably holds, identically (see [agreedDaysBase]).
  /// If the user edits while a sync runs, the local write is skipped, and recording the whole merge as agreed would make the
  /// next sync upload this device's stale copy of a day another device changed. The web app had that defect until
  /// 2026-10-03 and now does the same as this.
  Future<Map<String, String>> _agreedDaysBase(Map<String, DayData> merged, Map<String, String> previous) async {
    final localAfter = await localWorkoutRepository.readSnapshot();
    return agreedDaysBase(merged, localAfter?.data, previous);
  }

  /// After a refused write of workout days: the base from what the cloud and this device really hold now.
  Future<Map<String, String>> _daysBaseAfterPartialWrite(Map<String, String> previous) async {
    final cloud = await _cloudWorkout().readSnapshot();
    final local = await localWorkoutRepository.readSnapshot();
    return baseAfterPartialWrite(previous, baseDaysFrom(cloud?.data ?? {}), baseDaysFrom(local?.data ?? {}));
  }

  /// After a refused write of a collection: the base from what the cloud and this device really hold now.
  Future<Map<String, String>> _collectionBaseAfterPartialWrite(_CollectionSync c, Map<String, String> previous) async {
    final cloud = await c.readCloud();
    final local = await c.readLocal();
    return baseAfterPartialWrite(
      previous,
      collectionHashes(cloud == null ? null : c.toCollection(cloud)),
      collectionHashes(local == null ? null : c.toCollection(local)),
    );
  }

  Future<void> _createRestorePoint(
    WorkoutDataSnapshot? workoutData,
    TemplateSnapshot? templates,
    PlansSnapshot? plans,
  ) async {
    final existing = await getRestorePoints();
    final created = _now();
    final next = <String, Object?>{
      'id': '${created.millisecondsSinceEpoch}',
      'createdAt': created.toUtc().toIso8601String(),
      'workoutData': workoutData?.toJson(),
      'templates': templates?.toJson(),
      'plans': plans?.toJson(),
    };
    await settingsRepository.writeRestorePoints([next, ...existing].take(10).toList());
  }

  /// Returns the days both sides agree on after this sync (the new base).
  Future<Map<String, DayData>> _syncWorkoutData(
    WorkoutDataSnapshot? local,
    WorkoutDataSnapshot? cloud,
    WorkoutMerge? merge,
  ) async {
    if (local != null && cloud == null) {
      _assertUploadsAllowed();
      await _cloudWorkout().writeSnapshot(local);
      return local.data;
    }
    if (local == null && cloud != null) {
      await _writeLocal<WorkoutDataSnapshot>(
        read: localWorkoutRepository.readSnapshot,
        write: localWorkoutRepository.writeSnapshot,
        expected: _run.workout,
        next: cloud,
      );
      return cloud.data;
    }
    if (local == null || cloud == null || merge == null) return {};

    final merged = WorkoutDataSnapshot(version: local.version, updatedAt: _iso(), data: merge.merged);
    // See _applyCollection: a refused new day must not keep days from other devices from reaching this one.
    CloudLimitError? refused;
    if (_json(_daysJson(merge.merged)) != _json(_daysJson(cloud.data))) {
      try {
        _assertUploadsAllowed();
        await _cloudWorkout().writeSnapshot(merged);
      } on CloudLimitError catch (e) {
        refused = e;
      }
    }
    if (_json(_daysJson(merge.merged)) != _json(_daysJson(local.data))) {
      await _writeLocal<WorkoutDataSnapshot>(
        read: localWorkoutRepository.readSnapshot,
        write: localWorkoutRepository.writeSnapshot,
        expected: _run.workout,
        next: merged,
      );
    }
    if (refused != null) throw refused;
    return merge.merged;
  }
}
