import { SessionType, TemplateData } from "../../../types";
import { getSessionLabel } from "../sessionTypes/sessionTypeRules";

export interface TemplateShareEnvelope {
  version: 1;
  type: "daily-grind-template";
  exportedAt: string;
  session: SessionType;
  label: string;
  template: {
    warmup: { text: string; target?: string }[];
    main: { text: string; target?: string }[];
  };
}

export function buildTemplateExport(session: SessionType, template: TemplateData): string {
  const envelope: TemplateShareEnvelope = {
    version: 1,
    type: "daily-grind-template",
    exportedAt: new Date().toISOString(),
    session,
    label: getSessionLabel(session),
    template: {
      warmup: template.warmup.map((r) => ({ text: r.text, ...(r.target ? { target: r.target } : {}) })),
      main: template.main.map((r) => ({ text: r.text, ...(r.target ? { target: r.target } : {}) })),
    },
  };
  return JSON.stringify(envelope, null, 2);
}

function isRowArray(arr: unknown): arr is { text: string; target?: string }[] {
  return (
    Array.isArray(arr) &&
    arr.every(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        typeof (r as Record<string, unknown>).text === "string"
    )
  );
}

export function parseTemplateImport(raw: unknown): TemplateShareEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<TemplateShareEnvelope>;
  if (
    v.version !== 1 ||
    v.type !== "daily-grind-template" ||
    typeof v.session !== "string" ||
    !v.session.trim() ||
    typeof v.label !== "string" ||
    !v.template ||
    typeof v.template !== "object" ||
    !isRowArray(v.template.warmup) ||
    !isRowArray(v.template.main)
  ) {
    return null;
  }
  return v as TemplateShareEnvelope;
}
