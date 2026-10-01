import { DayData } from "../../types";
import { dayContentHash } from "./contentHash";

/**
 * A tombstone maps a deleted date to the content hash the day had when it was deleted.
 * Deleting is then a content-based decision that needs no clocks:
 *
 *   - "I deleted it" applies to the other side only if the other side's copy is still exactly what I deleted.
 *   - If the other side changed the day since, that edit is newer information and wins (the day is restored).
 */
export type Tombstones = Record<string, string>;

export interface DeletionReconciliation {
  /** Local days with dates that were deleted in the cloud (and unchanged here) removed. */
  local: Record<string, DayData>;
  /** Cloud days with dates that were deleted locally (and unchanged there) removed. */
  cloud: Record<string, DayData>;
  /** Dates to soft-delete in the cloud, with the hash they had. */
  deleteInCloud: Tombstones;
  /** Dates to remove from local storage. */
  deleteLocally: string[];
}

export function reconcileDeletions(
  localData: Record<string, DayData>,
  localDeleted: Tombstones,
  cloudData: Record<string, DayData>,
  cloudDeleted: Tombstones
): DeletionReconciliation {
  const local = { ...localData };
  const cloud = { ...cloudData };
  const deleteInCloud: Tombstones = {};
  const deleteLocally: string[] = [];

  for (const [date, deletedHash] of Object.entries(localDeleted)) {
    if (date in localData) continue; // re-created locally since: not a deletion any more
    const cloudDay = cloudData[date];
    if (cloudDay && dayContentHash(cloudDay) === deletedHash) {
      deleteInCloud[date] = deletedHash;
      delete cloud[date];
    }
    // Cloud copy differs (edited elsewhere after our delete): leave it, it is restored locally by the merge.
    // No cloud copy: already gone, nothing to do.
  }

  for (const [date, deletedHash] of Object.entries(cloudDeleted)) {
    const localDay = localData[date];
    if (localDay && dayContentHash(localDay) === deletedHash) {
      deleteLocally.push(date);
      delete local[date];
    }
    // Local copy differs: edited after the other device deleted it; the edit wins and un-deletes it on push.
  }

  return { local, cloud, deleteInCloud, deleteLocally };
}
