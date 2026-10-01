import { DayData, GeneratedPlanMeta, Plan, PlanParams, Templates } from "../../types";

export interface WorkoutDataSnapshot {
  version: number;
  updatedAt: string;
  data: Record<string, DayData>;
  /**
   * Deleted days: date -> content hash the day had when it was deleted (see deletionReconciliation).
   * On reads it lists known tombstones. On a cloud write it lists dates to soft-delete. On a local write
   * it is the set of tombstones to keep (omit to leave them as they are).
   */
  deletedDays?: Record<string, string>;
}

export interface TemplateSnapshot {
  version: number;
  updatedAt: string;
  data: Templates;
}

export interface PlansSnapshot {
  version: number;
  updatedAt: string;
  data: Plan[];
}

/**
 * Per-account preferences that should follow the user to every device. (Whether onboarding is done is
 * deliberately not here: re-running the plan wizard clears it on purpose, and a synced flag would let another
 * device dismiss the wizard mid-regeneration.)
 */
export interface SyncedSettings {
  activePlanId: string | null;
  planParams: PlanParams | null;
  planMeta: GeneratedPlanMeta | null;
}

export interface SettingsSnapshot {
  version: number;
  updatedAt: string;
  data: SyncedSettings;
}

export type SyncEntity = "workoutData" | "templates" | "plans" | "settings";
export type ConflictResolution = "keepLocal" | "keepCloud";

export interface SyncConflict {
  entity: SyncEntity;
  localUpdatedAt: string;
  cloudUpdatedAt: string;
  previewPaths: string[];
}

export interface SyncRestorePoint {
  id: string;
  createdAt: string;
  workoutData: WorkoutDataSnapshot | null;
  templates: TemplateSnapshot | null;
  plans: PlansSnapshot | null;
}

export interface SyncNowResult {
  status: "idle" | "success" | "error" | "conflict";
  conflicts: SyncConflict[];
  message: string;
  /** True when this sync changed data in local storage, so in-memory state must be reloaded. */
  appliedToLocal?: boolean;
  /** Why an "error" result happened, when the user should be told something specific. */
  reason?: "storageLimit" | "allowance";
  /** With reason "allowance": when the next sync opens (ISO), if the database said. */
  nextAvailableAt?: string | null;
}
