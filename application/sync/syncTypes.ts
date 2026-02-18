import { DayData, Templates } from "../../types";

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

export type SyncEntity = "workoutData" | "templates";
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
}

export interface SyncNowResult {
  status: "idle" | "success" | "error" | "conflict";
  conflicts: SyncConflict[];
  message: string;
}
