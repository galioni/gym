import { DayData, Plan, Templates } from "../../types";

export interface WorkoutDataSnapshot {
  version: number;
  updatedAt: string;
  data: Record<string, DayData>;
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

export type SyncEntity = "workoutData" | "templates" | "plans";
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
  status: "idle" | "success" | "error" | "conflict" | "upgradeRequired";
  conflicts: SyncConflict[];
  message: string;
}
