import { DayData, Templates } from "../../../types";
import { createEmptyDay } from "../../../utils";
import { getValidSessionType } from "../sessionTypes/sessionTypeRules";

/**
 * Coerces unknown day payload into a safe DayData shape with section-level recovery.
 */
export function sanitizeDayData(raw: unknown, date: string, templates: Templates): DayData {
  const record = (raw && typeof raw === "object" ? raw : {}) as Partial<DayData>;
  const sessionType = getValidSessionType(record.sessionType);
  const baseline = createEmptyDay(date, sessionType, templates);

  const normalizeItems = (items: unknown, fallback: DayData["warmup"]) => {
    if (!Array.isArray(items)) {
      return fallback;
    }
    const normalized = items
      .map((item) => (item && typeof item === "object" ? item : null))
      .filter((item): item is { id?: string; text?: string; target?: string; done?: boolean } => Boolean(item))
      .map((item, index) => ({
        id: typeof item.id === "string" && item.id.length > 0 ? item.id : `${date}-${index}`,
        text: typeof item.text === "string" ? item.text : "",
        target: typeof item.target === "string" ? item.target : undefined,
        done: Boolean(item.done),
      }))
      .filter((item) => item.text.trim().length > 0);

    return normalized.length > 0 ? normalized : fallback;
  };

  return {
    ...baseline,
    sessionType,
    warmup: normalizeItems(record.warmup, baseline.warmup),
    main: normalizeItems(record.main, baseline.main),
    warmupNotes: typeof record.warmupNotes === "string" ? record.warmupNotes : baseline.warmupNotes,
    mainNotes: typeof record.mainNotes === "string" ? record.mainNotes : baseline.mainNotes,
    rpe: typeof record.rpe === "string" ? record.rpe : baseline.rpe,
    warmupTimerMs: typeof record.warmupTimerMs === "number" ? Math.max(0, record.warmupTimerMs) : baseline.warmupTimerMs,
    mainTimerMs: typeof record.mainTimerMs === "number" ? Math.max(0, record.mainTimerMs) : baseline.mainTimerMs,
    weight: typeof record.weight === "string" ? record.weight : baseline.weight,
    checkNotes: typeof record.checkNotes === "string" ? record.checkNotes : baseline.checkNotes,
  };
}

export function sanitizeDayDataRecord(
  raw: unknown,
  templates: Templates
): Record<string, DayData> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const input = raw as Record<string, unknown>;
  return Object.entries(input).reduce<Record<string, DayData>>((accumulator, [date, value]) => {
    accumulator[date] = sanitizeDayData(value, date, templates);
    return accumulator;
  }, {});
}