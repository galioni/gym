import {
  EMPTY_TEMPLATE,
  TEMPLATE_TARGET_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
  TEMPLATES,
} from "../../../constants";
import { SessionType, TemplateData, Templates } from "../../../types";
import { cloneTemplateData } from "../sessionTypes/sessionTypeRules";

export interface TemplateValidationError {
  rowIndex: number;
  field: "text" | "target";
  message: string;
}

function normalizeCell(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function sanitizeRows(rows: Array<{ text: string; target?: string }>): Array<{ text: string; target?: string }> {
  return rows
    .map((row) => ({
      text: normalizeCell(row.text ?? "", TEMPLATE_TEXT_MAX_LENGTH),
      target: normalizeCell(row.target ?? "", TEMPLATE_TARGET_MAX_LENGTH),
    }))
    .filter((row) => row.text.length > 0)
    .map((row) => ({ text: row.text, target: row.target || undefined }));
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

  return {
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