import {
  EMPTY_TEMPLATE,
  TEMPLATE_TARGET_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
  TEMPLATES,
} from "../../../constants";
import { SessionType, TemplateData, Templates } from "../../../types";
import { cloneTemplateData } from "../sessionTypes/sessionTypeRules";
import { generateId } from "../../../utils";

export interface TemplateValidationError {
  rowIndex: number;
  field: "text" | "target";
  message: string;
}

function normalizeCell(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

type TemplateRow = { text: string; target?: string; equipment?: string; description?: string; videoUrl?: string; id?: string };

function sanitizeRows(rows: TemplateRow[]): TemplateRow[] {
  return rows
    .map((row) => ({
      id: row.id ?? generateId(),
      text: normalizeCell(row.text ?? "", TEMPLATE_TEXT_MAX_LENGTH),
      target: normalizeCell(row.target ?? "", TEMPLATE_TARGET_MAX_LENGTH),
      equipment: typeof row.equipment === "string" && row.equipment.trim().length > 0 ? row.equipment.trim().slice(0, 50) : undefined,
      description: typeof row.description === "string" && row.description.trim().length > 0 ? row.description.trim().slice(0, 200) : undefined,
      videoUrl: typeof row.videoUrl === "string" && row.videoUrl.trim().length > 0 ? row.videoUrl.trim() : undefined,
    }))
    .filter((row) => row.text.length > 0)
    .map((row) => ({
      id: row.id,
      text: row.text,
      target: row.target || undefined,
      equipment: row.equipment,
      description: row.description,
      videoUrl: row.videoUrl,
    }));
}

function sanitizeSessionTemplate(
  sessionInput: unknown,
  fallbackTemplate: TemplateData
): TemplateData {
  const safeSession = sessionInput && typeof sessionInput === "object"
    ? (sessionInput as Partial<TemplateData>)
    : null;

  const warmup = Array.isArray(safeSession?.warmup)
    ? sanitizeRows(safeSession.warmup as Array<{ text: string; target?: string }>)
    : fallbackTemplate.warmup;
  const main = Array.isArray(safeSession?.main)
    ? sanitizeRows(safeSession.main as Array<{ text: string; target?: string }>)
    : fallbackTemplate.main;

  const focus = typeof (safeSession as { focus?: unknown })?.focus === "string"
    ? ((safeSession as { focus: string }).focus.trim() || undefined)
    : undefined;

  const rawSource = (safeSession as { source?: unknown })?.source;
  const source: "ai" | "user" | undefined =
    rawSource === "ai" || rawSource === "user" ? rawSource : undefined;

  return {
    source,
    focus,
    warmup: warmup.length > 0 ? warmup : fallbackTemplate.warmup,
    main: main.length > 0 ? main : fallbackTemplate.main,
  };
}

export function validateTemplateRows(rows: Array<{ text: string; target?: string }>): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];

  rows.forEach((row, index) => {
    const text = (row.text ?? "").trim();
    const target = (row.target ?? "").trim();

    if (text.length === 0) {
      errors.push({ rowIndex: index, field: "text", message: "Exercise name is required." });
    }
    if (text.length > TEMPLATE_TEXT_MAX_LENGTH) {
      errors.push({
        rowIndex: index,
        field: "text",
        message: `Exercise name must be <= ${TEMPLATE_TEXT_MAX_LENGTH} characters.`,
      });
    }
    if (target.length > TEMPLATE_TARGET_MAX_LENGTH) {
      errors.push({
        rowIndex: index,
        field: "target",
        message: `Target must be <= ${TEMPLATE_TARGET_MAX_LENGTH} characters.`,
      });
    }
  });

  return errors;
}

/**
 * Recovers malformed template payloads by falling back per section instead of failing globally.
 */
export function sanitizeTemplates(payload: Partial<Templates> | null | undefined): Templates {
  const safe = payload ?? {};
  const nextTemplates: Templates = {};

  (Object.keys(TEMPLATES) as SessionType[]).forEach((session) => {
    nextTemplates[session] = sanitizeSessionTemplate(safe[session], cloneTemplateData(TEMPLATES[session]));
  });

  Object.entries(safe).forEach(([session, template]) => {
    if (session in nextTemplates || session.trim().length === 0) {
      return;
    }

    // Custom session types have no seeded workout rows, so malformed payloads fall back
    // to an empty template instead of impersonating one of the built-in sessions.
    nextTemplates[session] = sanitizeSessionTemplate(template, cloneTemplateData(EMPTY_TEMPLATE));
  });

  return nextTemplates;
}