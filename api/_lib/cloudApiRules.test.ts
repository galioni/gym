import { describe, expect, it } from "vitest";
import { isWorkoutSnapshotPayload, isTemplateSnapshotPayload, isPlansSnapshotPayload } from "./cloudApiRules";

const NOW = "2026-01-01T00:00:00.000Z";

describe("isWorkoutSnapshotPayload", () => {
  it("accepts a valid workout snapshot", () => {
    expect(isWorkoutSnapshotPayload({ version: 1, updatedAt: NOW, data: {} })).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(isWorkoutSnapshotPayload({ version: 1, updatedAt: NOW })).toBe(false);
    expect(isWorkoutSnapshotPayload({ version: 1, data: {} })).toBe(false);
    expect(isWorkoutSnapshotPayload(null)).toBe(false);
  });

  it("rejects non-ISO dates", () => {
    expect(isWorkoutSnapshotPayload({ version: 1, updatedAt: "not-a-date", data: {} })).toBe(false);
  });
});

describe("isTemplateSnapshotPayload", () => {
  it("accepts a valid template snapshot", () => {
    expect(
      isTemplateSnapshotPayload({ version: 1, updatedAt: NOW, templates: { gym: {} } })
    ).toBe(true);
  });

  it("rejects invalid session type keys", () => {
    expect(
      isTemplateSnapshotPayload({ version: 1, updatedAt: NOW, templates: { "UPPER CASE": {} } })
    ).toBe(false);
  });

  it("rejects missing templates field", () => {
    expect(isTemplateSnapshotPayload({ version: 1, updatedAt: NOW, data: {} })).toBe(false);
  });
});

describe("isPlansSnapshotPayload", () => {
  it("accepts a valid plans snapshot with plans array", () => {
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "plan_1", label: "Strength", sessionIds: ["gym", "rest"] }],
      })
    ).toBe(true);
  });

  it("accepts an empty plans array", () => {
    expect(isPlansSnapshotPayload({ version: 1, updatedAt: NOW, plans: [] })).toBe(true);
  });

  it("rejects plans with non-string sessionIds", () => {
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "p1", label: "X", sessionIds: [123] }],
      })
    ).toBe(false);
  });

  it("rejects plans with sessionIds that do not match session type key format", () => {
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "p1", label: "X", sessionIds: ["UPPER_CASE"] }],
      })
    ).toBe(false);
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "p1", label: "X", sessionIds: ["<script>alert(1)</script>"] }],
      })
    ).toBe(false);
  });

  it("rejects plans with empty id or label", () => {
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "", label: "X", sessionIds: [] }],
      })
    ).toBe(false);
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "p1", label: "", sessionIds: [] }],
      })
    ).toBe(false);
  });

  it("rejects plans missing required fields", () => {
    expect(
      isPlansSnapshotPayload({
        version: 1,
        updatedAt: NOW,
        plans: [{ id: "p1", sessionIds: [] }],
      })
    ).toBe(false);
  });

  it("rejects non-array plans field", () => {
    expect(isPlansSnapshotPayload({ version: 1, updatedAt: NOW, plans: {} })).toBe(false);
  });

  it("rejects missing plans field", () => {
    expect(isPlansSnapshotPayload({ version: 1, updatedAt: NOW })).toBe(false);
  });
});
