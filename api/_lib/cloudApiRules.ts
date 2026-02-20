function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isWorkoutSnapshotPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.version === "number" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.data)
  );
}

export function isTemplateSnapshotPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.version === "number" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.templates)
  );
}
