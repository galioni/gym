import { DayData } from "../../types";
import { ConflictResolution } from "./syncTypes";
import { dayContentHash, hashString, stableSerialize } from "./contentHash";

/**
 * What both sides last agreed on, stored as content hashes. It turns "the two copies differ" into
 * "who changed it": a three-way merge, so an ordinary edit is not mistaken for a conflict.
 */
export interface SyncBase {
  days: Record<string, string>;
  /** Per-item hashes (session type, plan id, settings field) of the last agreed state. */
  templates: Record<string, string>;
  plans: Record<string, string>;
  settings: Record<string, string>;
}

export const EMPTY_SYNC_BASE: SyncBase = { days: {}, templates: {}, plans: {}, settings: {} };

export function entityHash(data: unknown): string {
  return hashString(stableSerialize(data));
}

export interface WorkoutMerge {
  merged: Record<string, DayData>;
  /** Dates changed on both sides since the last agreement (or never agreed) with different content. */
  conflictKeys: string[];
}

/**
 * Per-day merge. Days on one side only are kept. Days on both sides are taken from whichever side changed
 * since the base; if both changed differently they are a conflict, decided by `resolution`
 * (local when unresolved; the caller must not write unresolved conflicts).
 */
export function mergeWorkoutDays(
  local: Record<string, DayData>,
  cloud: Record<string, DayData>,
  baseDays: Record<string, string>,
  resolution?: ConflictResolution
): WorkoutMerge {
  const merged: Record<string, DayData> = {};
  const conflictKeys: string[] = [];

  for (const date of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
    const localDay = local[date];
    const cloudDay = cloud[date];

    if (!localDay) {
      merged[date] = cloudDay;
    } else if (!cloudDay) {
      merged[date] = localDay;
    } else {
      const localHash = dayContentHash(localDay);
      const cloudHash = dayContentHash(cloudDay);
      if (localHash === cloudHash) {
        merged[date] = localDay;
        continue;
      }
      const baseHash = baseDays[date];
      const localChanged = localHash !== baseHash;
      const cloudChanged = cloudHash !== baseHash;
      if (baseHash !== undefined && localChanged && !cloudChanged) {
        merged[date] = localDay;
      } else if (baseHash !== undefined && !localChanged && cloudChanged) {
        merged[date] = cloudDay;
      } else {
        conflictKeys.push(date);
        merged[date] = resolution === "keepCloud" ? cloudDay : localDay;
      }
    }
  }

  return { merged, conflictKeys };
}

/**
 * An ordered set of keyed items: templates by session type, plans by id, settings by field.
 * `keys` is the display order; `items` holds the values.
 */
export interface Collection<T> {
  keys: string[];
  items: Record<string, T>;
}

export interface CollectionMerge<T> {
  merged: Collection<T>;
  /** Items changed on both sides since the last agreement (or never agreed) with different content. */
  conflictKeys: string[];
}

export interface MergeCollectionOptions {
  resolution?: ConflictResolution;
  /**
   * Both-changed items normally need a decision. For preferences nobody should be asked about, the local
   * side simply wins (the device the user is acting on pushes; other devices then pull).
   */
  localWinsConflicts?: boolean;
}

/**
 * Three-way merge of a keyed collection against the last agreed state (`base`, item hashes).
 *
 *   - Only one side has the item: added there if it was never agreed; otherwise the other side deleted it,
 *     and that deletion is honoured unless this side changed the item since (an edit beats a delete).
 *   - Both have it and it differs: whoever changed it since the base wins; if both changed it, or there is
 *     no base, it is a conflict.
 *
 * Order: items keep this device's order, then items only the cloud has, in the cloud's order.
 */
export function mergeCollection<T>(
  local: Collection<T>,
  cloud: Collection<T>,
  base: Record<string, string>,
  options: MergeCollectionOptions = {}
): CollectionMerge<T> {
  const chosen: Record<string, T> = {};
  const conflictKeys: string[] = [];

  for (const key of new Set([...local.keys, ...cloud.keys])) {
    const inLocal = Object.hasOwn(local.items, key);
    const inCloud = Object.hasOwn(cloud.items, key);
    const baseHash = base[key];

    if (inLocal && inCloud) {
      const localHash = entityHash(local.items[key]);
      const cloudHash = entityHash(cloud.items[key]);
      if (localHash === cloudHash) {
        chosen[key] = local.items[key];
        continue;
      }
      const localChanged = localHash !== baseHash;
      const cloudChanged = cloudHash !== baseHash;
      if (baseHash !== undefined && localChanged && !cloudChanged) {
        chosen[key] = local.items[key];
      } else if (baseHash !== undefined && !localChanged && cloudChanged) {
        chosen[key] = cloud.items[key];
      } else if (options.localWinsConflicts) {
        chosen[key] = local.items[key];
      } else {
        conflictKeys.push(key);
        chosen[key] = options.resolution === "keepCloud" ? cloud.items[key] : local.items[key];
      }
    } else if (inLocal) {
      // Never agreed: added here. Agreed before and gone from the cloud: deleted there, unless edited here since.
      if (baseHash === undefined || entityHash(local.items[key]) !== baseHash) chosen[key] = local.items[key];
    } else if (inCloud) {
      if (baseHash === undefined || entityHash(cloud.items[key]) !== baseHash) chosen[key] = cloud.items[key];
    }
  }

  const keys = [
    ...local.keys.filter((key) => Object.hasOwn(chosen, key)),
    ...cloud.keys.filter((key) => Object.hasOwn(chosen, key) && !local.keys.includes(key)),
  ];
  return { merged: { keys, items: chosen }, conflictKeys };
}

/**
 * The base to store after a sync: the hash of every merged item that this device now verifiably holds
 * identically (`localAfter`, re-read after the writes). Anything else keeps its previous base entry, or
 * none: a pull that was skipped (the user edited mid-sync) must not later look like a local deletion.
 */
export function agreedBase<T>(
  merged: Collection<T>,
  localAfter: Collection<T> | null,
  previous: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const key of merged.keys) {
    const mergedHash = entityHash(merged.items[key]);
    if (localAfter && Object.hasOwn(localAfter.items, key) && entityHash(localAfter.items[key]) === mergedHash) {
      next[key] = mergedHash;
    } else if (Object.hasOwn(previous, key)) {
      next[key] = previous[key];
    }
  }
  return next;
}

/** Hashes of every day in the agreed (post-sync) state. */
export function baseDaysFrom(finalDays: Record<string, DayData>): Record<string, string> {
  return Object.fromEntries(Object.entries(finalDays).map(([date, day]) => [date, dayContentHash(day)]));
}
