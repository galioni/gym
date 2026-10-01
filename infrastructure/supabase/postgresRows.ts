import { DayData, Plan, TemplateData, Templates } from "../../types";

/**
 * Pure mapping between app types and database rows (see supabase/migrations). Writes clamp values to the
 * database CHECK limits so one oversized field can never make an upsert fail and wedge sync; reads return
 * "raw" shapes that callers pass through the same sanitisers the local repositories use, so a day read back
 * from the database is structurally identical to the day that was written.
 */

const MS_PER_DAY = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 200;

export interface WorkoutDayRow {
  user_id: string;
  day: string;
  session_type: string;
  warmup: unknown[];
  main: unknown[];
  warmup_notes: string;
  main_notes: string;
  warmup_timer_ms: number;
  main_timer_ms: number;
  weight: string;
  check_notes: string;
  updated_at?: string;
  deleted_at: string | null;
  /** Hash of the content the day had when it was deleted. The database blanks the content of deleted days. */
  deleted_hash?: string | null;
}

export interface TemplateRow {
  user_id: string;
  session_type: string;
  label: string | null;
  focus: string | null;
  source: string | null;
  video_url: string | null;
  warmup: unknown[];
  main: unknown[];
  position: number;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface PlanRow {
  user_id: string;
  id: string;
  label: string;
  session_ids: string[];
  schedule: Record<string, string> | null;
  position: number;
  updated_at?: string;
  deleted_at?: string | null;
}

const clampText = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const clampTimer = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(MS_PER_DAY, Math.max(0, Math.round(value))) : 0;
const clampItems = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []);

export function isStorableDayKey(date: string): boolean {
  if (!DAY_KEY.test(date)) return false;
  const year = Number(date.slice(0, 4));
  return year >= 2000 && year <= 2100 && !Number.isNaN(Date.parse(date));
}

/** Returns null for a key the database cannot hold (corrupt local data must not block sync). */
export function dayToRow(userId: string, date: string, day: DayData): WorkoutDayRow | null {
  if (!isStorableDayKey(date)) return null;
  const sessionType = clampText(day.sessionType, 100);
  return {
    user_id: userId,
    day: date,
    session_type: sessionType.length > 0 ? sessionType : "unknown",
    warmup: clampItems(day.warmup),
    main: clampItems(day.main),
    warmup_notes: clampText(day.warmupNotes, 20000),
    main_notes: clampText(day.mainNotes, 20000),
    warmup_timer_ms: clampTimer(day.warmupTimerMs),
    main_timer_ms: clampTimer(day.mainTimerMs),
    weight: clampText(day.weight, 32),
    check_notes: clampText(day.checkNotes, 20000),
    deleted_at: null,
    deleted_hash: null,
  };
}

export function rowToRawDay(row: WorkoutDayRow): unknown {
  return {
    date: row.day,
    sessionType: row.session_type,
    warmup: row.warmup,
    main: row.main,
    warmupNotes: row.warmup_notes,
    mainNotes: row.main_notes,
    warmupTimerMs: row.warmup_timer_ms,
    mainTimerMs: row.main_timer_ms,
    weight: row.weight,
    checkNotes: row.check_notes,
  };
}

export function templatesToRows(userId: string, templates: Templates): TemplateRow[] {
  return Object.entries(templates)
    .filter(([sessionType]) => sessionType.length >= 1 && sessionType.length <= 100)
    .map(([sessionType, template], index) => ({
      user_id: userId,
      session_type: sessionType,
      label: typeof template.label === "string" ? template.label.slice(0, 200) : null,
      focus: typeof template.focus === "string" ? template.focus.slice(0, 500) : null,
      source: template.source === "ai" || template.source === "user" ? template.source : null,
      video_url: typeof template.videoUrl === "string" ? template.videoUrl.slice(0, 2000) : null,
      warmup: clampItems(template.warmup),
      main: clampItems(template.main),
      position: Math.min(index, 10000),
      deleted_at: null,
    }));
}

/** Rows come back in position order; optional fields are omitted when null so the shape matches local data. */
export function rowsToRawTemplates(rows: TemplateRow[]): Templates {
  const sorted = [...rows].sort((a, b) => a.position - b.position || a.session_type.localeCompare(b.session_type));
  return Object.fromEntries(
    sorted.map((row): [string, TemplateData] => {
      const template: Record<string, unknown> = { warmup: row.warmup, main: row.main };
      if (row.label !== null) template.label = row.label;
      if (row.focus !== null) template.focus = row.focus;
      if (row.source !== null) template.source = row.source;
      if (row.video_url !== null) template.videoUrl = row.video_url;
      return [row.session_type, template as unknown as TemplateData];
    })
  );
}

export function plansToRows(userId: string, plans: Plan[]): PlanRow[] {
  return plans
    .filter((plan) => plan.id.length >= 1 && plan.id.length <= 100)
    .map((plan, index) => ({
      user_id: userId,
      id: plan.id,
      label: plan.label.trim().length > 0 ? plan.label.slice(0, 200) : "Plan",
      session_ids: plan.sessionIds.slice(0, MAX_ITEMS),
      schedule: plan.schedule ? (plan.schedule as Record<string, string>) : null,
      position: Math.min(index, 10000),
      deleted_at: null,
    }));
}

export function rowsToPlans(rows: PlanRow[]): Plan[] {
  return [...rows]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((row) => {
      const plan: Plan = { id: row.id, label: row.label, sessionIds: row.session_ids };
      if (row.schedule !== null) plan.schedule = row.schedule as Plan["schedule"];
      return plan;
    });
}

export function latestUpdatedAt(rows: Array<{ updated_at?: string }>): string {
  const stamps = rows.map((row) => row.updated_at).filter((value): value is string => typeof value === "string");
  return stamps.length > 0 ? stamps.reduce((a, b) => (a > b ? a : b)) : new Date().toISOString();
}
