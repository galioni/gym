// Matches the normalization applied by sessionTypeRules.normalizeSessionTypeId:
// lowercase alphanumeric with internal hyphens, no leading/trailing hyphens, max 32 chars.
const SESSION_TYPE_KEY_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

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
