import {
  DEFAULT_SESSION_OPTIONS,
  DEFAULT_SESSION_TYPE,
  EMPTY_TEMPLATE,
  TEMPLATES,
} from "../../../constants";
import { SessionOption, SessionType, TemplateData, Templates } from "../../../types";

export interface CreateSessionTypeResult {
  status: "success" | "error";
  message: string;
  sessionType?: SessionType;
  templates?: Templates;
}

export interface DeleteSessionTypeResult {
  status: "success" | "error";
  message: string;
  templates?: Templates;
}

export interface RenameSessionTypeResult {
  status: "success" | "error";
  message: string;
  oldSessionType?: SessionType;
  newSessionType?: SessionType;
  templates?: Templates;
}

const SESSION_TYPE_ID_MAX_LENGTH = 32;
const BUILT_IN_LABELS = new Map(DEFAULT_SESSION_OPTIONS.map((option) => [option.value, option.label]));
const BUILT_IN_ORDER = DEFAULT_SESSION_OPTIONS.map((option) => option.value);

export function cloneTemplateData(template: TemplateData): TemplateData {
  return {
    warmup: template.warmup.map((row) => ({ ...row })),
    main: template.main.map((row) => ({ ...row })),
  };
}

export function getDefaultTemplate(sessionType: SessionType): TemplateData {
  return cloneTemplateData(TEMPLATES[sessionType] ?? EMPTY_TEMPLATE);
}

export function getSessionLabel(sessionType: SessionType): string {
  const builtIn = BUILT_IN_LABELS.get(sessionType);
  if (builtIn) {
    return builtIn;
  }

  return sessionType
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getSessionOptions(templates: Templates): SessionOption[] {
  const customOptions = Object.keys(templates)
    .filter((sessionType) => !BUILT_IN_LABELS.has(sessionType))
    .sort((a, b) => getSessionLabel(a).localeCompare(getSessionLabel(b)))
    .map((sessionType) => ({
      value: sessionType,
      label: getSessionLabel(sessionType),
    }));

  return [
    ...BUILT_IN_ORDER.map((sessionType) => ({
      value: sessionType,
      label: BUILT_IN_LABELS.get(sessionType) ?? getSessionLabel(sessionType),
    })),
    ...customOptions,
  ];
}

export function normalizeSessionTypeId(value: string): SessionType | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SESSION_TYPE_ID_MAX_LENGTH);

  return normalized.length > 0 ? normalized : null;
}

export function createSessionType(templates: Templates, label: string): CreateSessionTypeResult {
  const sessionType = normalizeSessionTypeId(label);
  if (!sessionType) {
    return {
      status: "error",
      message: "Enter a session type name using letters or numbers.",
    };
  }

  if (templates[sessionType]) {
    return {
      status: "error",
      message: `Session type "${getSessionLabel(sessionType)}" already exists.`,
    };
  }

  return {
    status: "success",
    sessionType,
    message: `Session type "${getSessionLabel(sessionType)}" added.`,
    templates: {
      ...templates,
      [sessionType]: cloneTemplateData(EMPTY_TEMPLATE),
    },
  };
}

export function isBuiltInSessionType(sessionType: SessionType): boolean {
  return BUILT_IN_LABELS.has(sessionType);
}

export function deleteSessionType(
  templates: Templates,
  sessionType: SessionType
): DeleteSessionTypeResult {
  if (isBuiltInSessionType(sessionType)) {
    return {
      status: "error",
      message: `Cannot delete built-in session type "${getSessionLabel(sessionType)}".`,
    };
  }
  if (!templates[sessionType]) {
    return {
      status: "error",
      message: `Session type "${getSessionLabel(sessionType)}" not found.`,
    };
  }

  const { [sessionType]: _removed, ...remaining } = templates;
  return {
    status: "success",
    message: `Session type "${getSessionLabel(sessionType)}" deleted.`,
    templates: remaining as Templates,
  };
}

export function renameSessionType(
  templates: Templates,
  oldType: SessionType,
  newLabel: string
): RenameSessionTypeResult {
  if (isBuiltInSessionType(oldType)) {
    return {
      status: "error",
      message: `Cannot rename built-in session type "${getSessionLabel(oldType)}".`,
    };
  }
  const newType = normalizeSessionTypeId(newLabel);
  if (!newType) {
    return {
      status: "error",
      message: "Enter a session type name using letters or numbers.",
    };
  }
  if (newType === oldType) {
    return { status: "error", message: "New name is the same as the current name." };
  }
  if (templates[newType]) {
    return {
      status: "error",
      message: `Session type "${getSessionLabel(newType)}" already exists.`,
    };
  }

  const { [oldType]: data, ...remaining } = templates;
  return {
    status: "success",
    oldSessionType: oldType,
    newSessionType: newType,
    message: `Session type renamed to "${getSessionLabel(newType)}".`,
    templates: { ...remaining, [newType]: data } as Templates,
  };
}

export function getValidSessionType(value: unknown): SessionType {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return DEFAULT_SESSION_TYPE;
}