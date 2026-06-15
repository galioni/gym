export type SessionType = string;

export interface SessionOption {
  value: SessionType;
  label: string;
}

export interface WorkoutItem {
  id: string;
  text: string;
  target?: string;
  done: boolean;
}

export interface DayData {
  date: string;
  sessionType: SessionType;
  warmup: WorkoutItem[];
  main: WorkoutItem[];
  warmupNotes: string;
  mainNotes: string;
  warmupTimerMs: number;
  mainTimerMs: number;
  weight: string;
  checkNotes: string;
}

export interface TemplateData {
  warmup: { text: string; target?: string; id?: string }[];
  main: { text: string; target?: string; id?: string }[];
}

export type Templates = Record<SessionType, TemplateData>;

export interface Plan {
  id: string;
  label: string;
  /** References session types from the shared templates pool */
  sessionIds: SessionType[];
}

export interface PlanParams {
  goal: "strength" | "muscle" | "weight_loss" | "endurance" | "active";
  experience: "beginner" | "intermediate" | "advanced";
  daysPerWeek: number;
  equipment: "full_gym" | "home_gym" | "minimal" | "bodyweight";
  duration: "30" | "45" | "60" | "90";
  bodyFocus: string[];
}