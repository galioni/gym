import {
  PLANS_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATES,
} from "../../../constants";
import { sanitizeDayDataRecord } from "../../workout/data/dayDataRules";
import { sanitizeTemplates } from "../../workout/templates/templateRules";
import { DayData, Plan, Templates } from "../../../types";

function isValidPlan(value: unknown): value is Plan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    Array.isArray(p.sessionIds) &&
    (p.sessionIds as unknown[]).every((s) => typeof s === "string")
  );
}

/**
 * Migrates raw localStorage JSON to the current WorkoutDataSnapshot format.
 *
 * Handles:
 *   - null / non-object input → empty snapshot
 *   - legacy v0 plain record (no envelope) → v1 envelope
 *   - current v1 envelope → preserved updatedAt, sanitized data
 */
export function migrateRawWorkoutSnapshot(raw: unknown): {
  version: number;
  updatedAt: string;
  data: Record<string, DayData>;
} {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: STORAGE_SCHEMA_VERSION, updatedAt: now, data: {} };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number" || !("data" in obj)) {
    return {
      version: STORAGE_SCHEMA_VERSION,
      updatedAt: now,
      data: sanitizeDayDataRecord(raw as Record<string, unknown>, TEMPLATES),
    };
  }
  return {
    version: STORAGE_SCHEMA_VERSION,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : now,
    data: sanitizeDayDataRecord(obj.data as Record<string, unknown>, TEMPLATES),
  };
}

/**
 * Migrates raw localStorage JSON to the current TemplateSnapshot format.
 *
 * Handles:
 *   - null / non-object input → empty snapshot
 *   - legacy v0 plain templates object (no envelope) → v1 envelope
 *   - current v1 envelope → preserved updatedAt, sanitized data
 */
export function migrateRawTemplateSnapshot(raw: unknown): {
  version: number;
  updatedAt: string;
  data: Templates;
} {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: TEMPLATE_SCHEMA_VERSION, updatedAt: now, data: sanitizeTemplates({}) };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number" || !("templates" in obj)) {
    return {
      version: TEMPLATE_SCHEMA_VERSION,
      updatedAt: now,
      data: sanitizeTemplates(raw as Partial<Templates>),
    };
  }
  return {
    version: TEMPLATE_SCHEMA_VERSION,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : now,
    data: sanitizeTemplates(obj.templates as Partial<Templates>),
  };
}

/**
 * Migrates raw localStorage JSON to the current PlansSnapshot format.
 *
 * Handles:
 *   - null / non-object / invalid input → empty snapshot
 *   - legacy v0 plain array → v1 envelope (invalid entries filtered out)
 *   - current v1 envelope → preserved updatedAt, invalid entries filtered out
 */
export function migrateRawPlansSnapshot(raw: unknown): {
  version: number;
  updatedAt: string;
  data: Plan[];
} {
  const now = new Date().toISOString();
  if (Array.isArray(raw)) {
    return {
      version: PLANS_SCHEMA_VERSION,
      updatedAt: now,
      data: raw.filter(isValidPlan),
    };
  }
  if (!raw || typeof raw !== "object") {
    return { version: PLANS_SCHEMA_VERSION, updatedAt: now, data: [] };
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.version !== "number" ||
    typeof obj.updatedAt !== "string" ||
    !Array.isArray(obj.plans)
  ) {
    return { version: PLANS_SCHEMA_VERSION, updatedAt: now, data: [] };
  }
  return {
    version: PLANS_SCHEMA_VERSION,
    updatedAt: obj.updatedAt,
    data: (obj.plans as unknown[]).filter(isValidPlan),
  };
}
