import {
  ACTIVE_PLAN_STORAGE_KEY,
  DELETED_DAYS_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  PLAN_META_STORAGE_KEY,
  PLAN_PARAMS_STORAGE_KEY,
  PLANS_STORAGE_KEY,
  STORAGE_KEY,
  SYNC_BASE_STORAGE_KEY,
  SYNC_OWNER_STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
} from "../../constants";

/**
 * Local data is not namespaced per account, and sync would upload it to whoever is signed in. This records
 * which account the data in this browser belongs to so sync can refuse to cross accounts.
 */
export type OwnerCheck = "owned" | "claimed" | "mismatch";

/**
 * "claimed": nothing was recorded yet, so this browser's existing data is assigned to this account
 * (it predates accounts or was created while signed in). "mismatch": the data belongs to someone else.
 */
export function checkSyncOwner(userId: string): OwnerCheck {
  try {
    const owner = localStorage.getItem(SYNC_OWNER_STORAGE_KEY);
    if (owner === userId) return "owned";
    if (owner === null) {
      localStorage.setItem(SYNC_OWNER_STORAGE_KEY, userId);
      return "claimed";
    }
    return "mismatch";
  } catch {
    // Storage unavailable: sync cannot compare owners, so do not sync.
    return "mismatch";
  }
}

const OWNED_DATA_KEYS = [
  STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  PLANS_STORAGE_KEY,
  ACTIVE_PLAN_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_BASE_STORAGE_KEY,
  DELETED_DAYS_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  PLAN_PARAMS_STORAGE_KEY,
  PLAN_META_STORAGE_KEY,
];

/** Removes the previous account's data from this browser and assigns the browser to `userId`. */
export function switchSyncOwner(userId: string): void {
  for (const key of OWNED_DATA_KEYS) {
    localStorage.removeItem(key);
  }
  localStorage.setItem(SYNC_OWNER_STORAGE_KEY, userId);
}
