import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DayData, SessionType, Templates } from "./types";
import { EMPTY_TEMPLATE, TEMPLATES } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Formats a Date using local calendar fields for stable YYYY-MM-DD keys.
 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD key into a local-midnight Date to avoid UTC drift.
 */
export function fromLocalDateKey(dateKey: string): Date {
  const [rawYear, rawMonth, rawDay] = dateKey.split("-");
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

export function formatTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function vibrate(pattern: number | number[] = 10) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

export function createEmptyDay(date: string, sessionType: SessionType, templates: Templates = TEMPLATES): DayData {
  const template = templates[sessionType] ?? EMPTY_TEMPLATE;
  return {
    date,
    sessionType,
    warmup: template.warmup.map((row) => ({ ...row, id: generateId(), done: false })),
    main: template.main.map((row) => ({ ...row, id: generateId(), done: false })),
    warmupNotes: "",
    mainNotes: "",
    warmupTimerMs: 0,
    mainTimerMs: 0,
    weight: "",
    checkNotes: ""
  };
}

export function getFridayHint(
  enabled: boolean,
  targetTime: string,
  now: Date = new Date()
): string | null {
  if (!enabled) return null;
  if (now.getDay() !== 5) return null;

  const [hourStr, minuteStr] = targetTime.split(":");
  const targetMinutes = Number(hourStr) * 60 + Number(minuteStr);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (nowMinutes > targetMinutes) return null;

  return `Friday weight check: aim ~${targetTime}`;
}

export function getProgress(day: DayData) {
  const allItems = [...day.warmup, ...day.main];
  const total = allItems.length;
  if (total === 0) return 0;
  const done = allItems.filter(x => x.done).length;
  return Math.round((done / total) * 100);
}