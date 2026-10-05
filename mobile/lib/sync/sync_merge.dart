/// Port of `application/sync/syncMerge.ts`, `deletionReconciliation.ts` and the pure part of
/// `historyWindow.ts`. Behaviour is pinned by contract/syncMerge.fixtures.json, which the web app generates;
/// change either side only together with the fixture.
library;

import '../domain/models.dart';
import 'content_hash.dart';
import 'day_hash.dart';

enum ConflictResolution { keepLocal, keepCloud }

// ---------------------------------------------------------------------------
// Workout days
// ---------------------------------------------------------------------------

class WorkoutMerge {
  const WorkoutMerge(this.merged, this.conflictKeys);

  final Map<String, DayData> merged;

  /// Dates changed on both sides since the last agreement (or never agreed) with different content.
  final List<String> conflictKeys;
}

/// Per-day three-way merge against [baseDays] (date -> hash of the last agreed content). A day on one side
/// only is kept. A day on both sides comes from whichever side changed since the base; if both changed, or
/// there is no base, it is a conflict decided by [resolution] (local when unresolved: the caller must not
/// write unresolved conflicts).
WorkoutMerge mergeWorkoutDays(
  Map<String, DayData> local,
  Map<String, DayData> cloud,
  Map<String, String> baseDays, [
  ConflictResolution? resolution,
]) {
  final merged = <String, DayData>{};
  final conflictKeys = <String>[];

  for (final date in {...local.keys, ...cloud.keys}) {
    final localDay = local[date];
    final cloudDay = cloud[date];
    if (localDay == null) {
      merged[date] = cloudDay!;
    } else if (cloudDay == null) {
      merged[date] = localDay;
    } else {
      final localHash = dayContentHash(localDay);
      final cloudHash = dayContentHash(cloudDay);
      if (localHash == cloudHash) {
        merged[date] = localDay;
        continue;
      }
      final baseHash = baseDays[date];
      final localChanged = localHash != baseHash;
      final cloudChanged = cloudHash != baseHash;
      if (baseHash != null && localChanged && !cloudChanged) {
        merged[date] = localDay;
      } else if (baseHash != null && !localChanged && cloudChanged) {
        merged[date] = cloudDay;
      } else {
        conflictKeys.add(date);
        merged[date] = resolution == ConflictResolution.keepCloud ? cloudDay : localDay;
      }
    }
  }
  return WorkoutMerge(merged, conflictKeys);
}

/// Hashes of every day in the agreed (post-sync) state.
Map<String, String> baseDaysFrom(Map<String, DayData> finalDays) =>
    {for (final e in finalDays.entries) e.key: dayContentHash(e.value)};

// ---------------------------------------------------------------------------
// Keyed collections (templates by session type, plans by id, settings by field)
// ---------------------------------------------------------------------------

/// An ordered set of keyed items. [keys] is the display order; [items] holds the JSON-shaped values.
class Collection {
  const Collection(this.keys, this.items);

  static const empty = Collection([], {});

  final List<String> keys;
  final Map<String, Object?> items;

  Json toJson() => {'keys': keys, 'items': items};
}

class CollectionMerge {
  const CollectionMerge(this.merged, this.conflictKeys);

  final Collection merged;
  final List<String> conflictKeys;
}

/// Three-way merge of a keyed collection against the last agreed state ([base], item hashes).
///
///  - Only one side has the item: added there if never agreed; otherwise the other side deleted it and that
///    is honoured unless this side changed the item since (an edit beats a delete).
///  - Both have it and it differs: whoever changed it since the base wins; if both changed it, or there is no
///    base, it is a conflict (or local wins when [localWinsConflicts]).
///
/// Order: this device's order, then cloud-only items in the cloud's order.
CollectionMerge mergeCollection(
  Collection local,
  Collection cloud,
  Map<String, String> base, {
  ConflictResolution? resolution,
  bool localWinsConflicts = false,
}) {
  final chosen = <String, Object?>{};
  final conflictKeys = <String>[];

  for (final key in {...local.keys, ...cloud.keys}) {
    final inLocal = local.items.containsKey(key);
    final inCloud = cloud.items.containsKey(key);
    final baseHash = base[key];

    if (inLocal && inCloud) {
      final localHash = entityHash(local.items[key]);
      final cloudHash = entityHash(cloud.items[key]);
      if (localHash == cloudHash) {
        chosen[key] = local.items[key];
        continue;
      }
      final localChanged = localHash != baseHash;
      final cloudChanged = cloudHash != baseHash;
      if (baseHash != null && localChanged && !cloudChanged) {
        chosen[key] = local.items[key];
      } else if (baseHash != null && !localChanged && cloudChanged) {
        chosen[key] = cloud.items[key];
      } else if (localWinsConflicts) {
        chosen[key] = local.items[key];
      } else {
        conflictKeys.add(key);
        chosen[key] = resolution == ConflictResolution.keepCloud ? cloud.items[key] : local.items[key];
      }
    } else if (inLocal) {
      if (baseHash == null || entityHash(local.items[key]) != baseHash) chosen[key] = local.items[key];
    } else if (inCloud) {
      if (baseHash == null || entityHash(cloud.items[key]) != baseHash) chosen[key] = cloud.items[key];
    }
  }

  final keys = [
    ...local.keys.where(chosen.containsKey),
    ...cloud.keys.where((k) => chosen.containsKey(k) && !local.keys.contains(k)),
  ];
  return CollectionMerge(Collection(keys, chosen), conflictKeys);
}

/// The base to store after a sync: the hash of every merged item that this device now verifiably holds
/// identically ([localAfter], re-read after the writes). Anything else keeps its previous entry, or none: a
/// skipped pull must not later look like a local deletion.
Map<String, String> agreedBase(Collection merged, Collection? localAfter, Map<String, String> previous) {
  final next = <String, String>{};
  for (final key in merged.keys) {
    final mergedHash = entityHash(merged.items[key]);
    if (localAfter != null &&
        localAfter.items.containsKey(key) &&
        entityHash(localAfter.items[key]) == mergedHash) {
      next[key] = mergedHash;
    } else if (previous.containsKey(key)) {
      next[key] = previous[key]!;
    }
  }
  return next;
}

/// The base to store after a sync of workout days (the web's `agreedDaysBase`): like [agreedBase], but with one more rule.
/// A day this device holds that differs from the merge, with no earlier entry to keep, is the user's own edit made while the
/// sync ran, so the merged hash is its base and the edit is uploaded next time instead of being reported as a conflict. A day
/// this device lacks gets no entry: a skipped pull must not later look like a local deletion.
Map<String, String> agreedDaysBase(Map<String, DayData> merged, Map<String, DayData>? localAfter, Map<String, String> previous) {
  final next = <String, String>{};
  for (final entry in merged.entries) {
    final date = entry.key;
    final mergedHash = dayContentHash(entry.value);
    if (localAfter != null && localAfter.containsKey(date) && dayContentHash(localAfter[date]!) == mergedHash) {
      next[date] = mergedHash;
    } else if (previous.containsKey(date)) {
      next[date] = previous[date]!;
    } else if (localAfter != null && localAfter.containsKey(date)) {
      next[date] = mergedHash;
    }
  }
  return next;
}

/// The hash of every item in a keyed collection.
Map<String, String> collectionHashes(Collection? collection) => collection == null
    ? {}
    : {for (final key in collection.keys) key: entityHash(collection.items[key])};

/// The base to store after a sync in which the cloud accepted only part of what was sent. Recomputed from
/// what the cloud really holds, not from what was intended (see the web implementation for the three rules).
Map<String, String> baseAfterPartialWrite(
  Map<String, String> previous,
  Map<String, String> cloudHashes,
  Map<String, String> localHashes,
) {
  final next = <String, String>{};
  for (final e in cloudHashes.entries) {
    if (localHashes[e.key] == e.value) {
      next[e.key] = e.value;
    } else if (previous.containsKey(e.key)) {
      next[e.key] = previous[e.key]!;
    }
  }
  for (final key in previous.keys) {
    if (!cloudHashes.containsKey(key) && localHashes.containsKey(key)) next[key] = previous[key]!;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Deletions
// ---------------------------------------------------------------------------

/// date -> content hash the day had when it was deleted. Deletion is a content-based decision that needs no
/// clocks: it applies to the other side only if that side's copy is still exactly what was deleted.
typedef Tombstones = Map<String, String>;

class DeletionReconciliation {
  const DeletionReconciliation({
    required this.local,
    required this.cloud,
    required this.deleteInCloud,
    required this.deleteLocally,
  });

  final Map<String, DayData> local;
  final Map<String, DayData> cloud;
  final Tombstones deleteInCloud;
  final List<String> deleteLocally;
}

DeletionReconciliation reconcileDeletions(
  Map<String, DayData> localData,
  Tombstones localDeleted,
  Map<String, DayData> cloudData,
  Tombstones cloudDeleted,
) {
  final local = {...localData};
  final cloud = {...cloudData};
  final deleteInCloud = <String, String>{};
  final deleteLocally = <String>[];

  for (final e in localDeleted.entries) {
    if (localData.containsKey(e.key)) continue; // re-created locally since: not a deletion any more
    final cloudDay = cloudData[e.key];
    if (cloudDay != null && dayContentHash(cloudDay) == e.value) {
      deleteInCloud[e.key] = e.value;
      cloud.remove(e.key);
    }
  }

  for (final e in cloudDeleted.entries) {
    final localDay = localData[e.key];
    if (localDay != null && dayContentHash(localDay) == e.value) {
      deleteLocally.add(e.key);
      local.remove(e.key);
    }
  }

  return DeletionReconciliation(
    local: local,
    cloud: cloud,
    deleteInCloud: deleteInCloud,
    deleteLocally: deleteLocally,
  );
}

// ---------------------------------------------------------------------------
// History window (Free plan keeps the last 7 days in the cloud)
// ---------------------------------------------------------------------------

const freeHistoryDays = 7;

String _pad(int n) => n.toString().padLeft(2, '0');

/// The oldest day (YYYY-MM-DD, in the reader's own calendar) that still counts, for a window of [days] days.
String historyCutoff(int days, [DateTime? now]) {
  final n = now ?? DateTime.now();
  final oldest = DateTime(n.year, n.month, n.day - (days - 1));
  return '${oldest.year.toString().padLeft(4, '0')}-${_pad(oldest.month)}-${_pad(oldest.day)}';
}

/// Narrows what this device uploads; nothing older than [cutoff] is sent, as a day or as a deletion.
Map<String, T> keepRecent<T>(Map<String, T> record, String cutoff) => {
      for (final e in record.entries)
        if (e.key.compareTo(cutoff) >= 0) e.key: e.value,
    };
