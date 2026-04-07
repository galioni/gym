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
  rpe: string;
  warmupTimerMs: number;
  mainTimerMs: number;
  weight: string;
  checkNotes: string;
}

export interface TemplateData {
  warmup: { text: string; target?: string }[];
  main: { text: string; target?: string }[];
}

export type Templates = Record<SessionType, TemplateData>;