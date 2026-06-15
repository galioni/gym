// Matches session type keys produced by normalizeSessionTypeId (hyphens) and
// AI-generated plans (snake_case with underscores). Both are valid identifiers.
const SESSION_TYPE_KEY_RE = /^[a-z0-9]([a-z0-9_-]{0,30}[a-z0-9])?$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDateString(value: unknown): boolean {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function hasValidTemplateKeys(templates: Record<string, unknown>): boolean {
  return Object.keys(templates).every((key) => SESSION_TYPE_KEY_RE.test(key));
}

export function isWorkoutSnapshotPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.version === "number" &&
    isIsoDateString(value.updatedAt) &&
    isRecord(value.data)
  );
}

export function isTemplateSnapshotPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.version === "number" &&
    isIsoDateString(value.updatedAt) &&
    isRecord(value.templates) &&
    hasValidTemplateKeys(value.templates)
  );
}

export function isPlansSnapshotPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.version !== "number" || !isIsoDateString(value.updatedAt)) {
    return false;
  }
  if (!Array.isArray(value.plans)) {
    return false;
  }
  return value.plans.every(
    (p) =>
      isRecord(p) &&
      typeof p.id === "string" &&
      p.id.length > 0 &&
      typeof p.label === "string" &&
      p.label.length > 0 &&
      Array.isArray(p.sessionIds) &&
      // sessionIds reference session type keys — enforce the same format as template keys
      (p.sessionIds as unknown[]).every(
        (s) => typeof s === "string" && SESSION_TYPE_KEY_RE.test(s)
      )
  );
}
