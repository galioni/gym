import {
  TEMPLATE_TARGET_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
  TEMPLATES,
} from "../../../constants";
import { SessionType, TemplateData, Templates } from "../../../types";

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

  const sanitizeSession = (session: SessionType): TemplateData => {
    const sessionInput = safe[session];
    if (!sessionInput) {
      return TEMPLATES[session];
    }

    const warmup = Array.isArray(sessionInput.warmup)
      ? sanitizeRows(sessionInput.warmup as Array<{ text: string; target?: string }>)
      : TEMPLATES[session].warmup;
    const main = Array.isArray(sessionInput.main)
      ? sanitizeRows(sessionInput.main as Array<{ text: string; target?: string }>)
      : TEMPLATES[session].main;

    return {
      warmup: warmup.length > 0 ? warmup : TEMPLATES[session].warmup,
      main: main.length > 0 ? main : TEMPLATES[session].main,
    };
  };

  return {
    tennis: sanitizeSession("tennis"),
    gym: sanitizeSession("gym"),
    swim: sanitizeSession("swim"),
    rest: sanitizeSession("rest"),
  };
}

