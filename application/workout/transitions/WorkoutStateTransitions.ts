import { DayData, SessionType, Templates } from "../../../types";
import { createEmptyDay } from "../../../utils";

export type WorkoutSectionKey = "warmup" | "main";

/**
 * Applies partial day updates while preserving existing fields.
 */
export function applyDayUpdates(day: DayData, updates: Partial<DayData>): DayData {
  return { ...day, ...updates };
}

/**
 * Toggles a checklist item in the requested section.
 */
export function toggleItemInSection(
  day: DayData,
  section: WorkoutSectionKey,
  id: string,
  done: boolean
): DayData {
  const nextItems = day[section].map((item) => (item.id === id ? { ...item, done } : item));
  return applyDayUpdates(day, { [section]: nextItems });
}

/**
 * Deletes a checklist item in the requested section.
 */
export function deleteItemInSection(day: DayData, section: WorkoutSectionKey, id: string): DayData {
  const nextItems = day[section].filter((item) => item.id !== id);
  return applyDayUpdates(day, { [section]: nextItems });
}

/**
 * Resets workout sections from template while preserving check-in fields.
 */
export function resetSectionsFromTemplate(
  date: string,
  sessionType: SessionType,
  day: DayData,
  templates?: Templates
): DayData {
  const freshTemplate = createEmptyDay(date, sessionType, templates);
  return applyDayUpdates(day, {
    sessionType,
    warmup: freshTemplate.warmup,
    main: freshTemplate.main,
    warmupTimerMs: 0,
    mainTimerMs: 0,
  });
}

/**
 * Clears day state except selected session type.
 */
export function clearDayKeepingSession(date: string, sessionType: SessionType, templates?: Templates): DayData {
  return createEmptyDay(date, sessionType, templates);
}
