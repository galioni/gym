export type SessionType = string;

export interface SessionOption {
  value: SessionType;
  label: string;
  focus?: string;
  source?: "ai" | "user";
}

export interface WorkoutItem {
  id: string;
  text: string;
  target?: string;
  equipment?: string;
  description?: string;
  videoUrl?: string;
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

export type TemplateSectionKey = "warmup" | "main";

export interface TemplateData {
  source?: "ai" | "user";
  label?: string;
  focus?: string;
  videoUrl?: string;
  warmup: { text: string; target?: string; equipment?: string; description?: string; videoUrl?: string; id?: string }[];
  main: { text: string; target?: string; equipment?: string; description?: string; videoUrl?: string; id?: string }[];
}

export interface GeneratedPlanMeta {
  split: string;
  schedule: string[];
  progression: string;
  notes?: string;
}

export type Templates = Record<SessionType, TemplateData>;

/** 0 = Monday … 6 = Sunday */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Plan {
  id: string;
  label: string;
  /** References session types from the shared templates pool */
  sessionIds: SessionType[];
  /**
   * Optional day assignments. When present, WeekPlanBar shows a day-column
   * view instead of ordered pills, and "next" is computed by actual day.
   * sessionIds remains the canonical session list (used for header filtering).
   */
  schedule?: Partial<Record<WeekDay, SessionType>>;
}

export interface PlanParams {
  goal: "strength" | "muscle" | "weight_loss" | "endurance" | "active";
  experience: "beginner" | "intermediate" | "advanced";
  daysPerWeek: number;
  equipment: "full_gym" | "home_gym" | "minimal" | "bodyweight";
  duration: "30" | "45" | "60" | "90";
  bodyFocus: string[];
}