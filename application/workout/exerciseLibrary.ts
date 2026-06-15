import { DayData } from "../../types";

export interface ExerciseLibraryEntry {
  text: string;
  target?: string;
}

/**
 * Derives a deduplicated exercise list from workout history.
 * Most-recently-used entry wins when two exercises share a normalised name.
 * The returned array is sorted alphabetically for consistent display.
 */
export function buildExerciseLibrary(allData: Record<string, DayData>): ExerciseLibraryEntry[] {
  const seen = new Map<string, ExerciseLibraryEntry>();

  // Sort descending so the first occurrence we hit is the most recent.
  const sorted = Object.values(allData).sort((a, b) => b.date.localeCompare(a.date));

  for (const day of sorted) {
    for (const item of [...day.warmup, ...day.main]) {
      const key = item.text.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, { text: item.text.trim(), target: item.target || undefined });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.text.localeCompare(b.text));
}
