import { describe, expect, it } from "vitest";
import {
  migrateRawPlansSnapshot,
  migrateRawTemplateSnapshot,
  migrateRawWorkoutSnapshot,
} from "./snapshotMigrations";
import {
  PLANS_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATES,
} from "../../../constants";

describe("migrateRawWorkoutSnapshot", () => {
  it("returns empty snapshot for null input", () => {
    const result = migrateRawWorkoutSnapshot(null);
    expect(result.version).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.data).toEqual({});
    expect(typeof result.updatedAt).toBe("string");
  });

  it("returns empty snapshot for array input", () => {
    const result = migrateRawWorkoutSnapshot([]);
    expect(result.data).toEqual({});
  });

  it("migrates legacy v0 plain record (no envelope) to current version", () => {
    const legacy = {
      "2026-01-15": {
        date: "2026-01-15",
        sessionType: "gym",
        warmup: [],
        main: [],
        warmupNotes: "",
        mainNotes: "",
        warmupTimerMs: 0,
        mainTimerMs: 0,
        weight: "",
        checkNotes: "",
      },
    };
    const result = migrateRawWorkoutSnapshot(legacy);
    expect(result.version).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.data["2026-01-15"]).toBeDefined();
    expect(result.data["2026-01-15"].sessionType).toBe("gym");
  });

  it("reads current v1 envelope and preserves updatedAt", () => {
    const envelope = {
      version: 1,
      updatedAt: "2026-03-10T08:00:00.000Z",
      data: {
        "2026-03-10": {
          date: "2026-03-10",
          sessionType: "gym",
          warmup: [],
          main: [],
          warmupNotes: "notes",
          mainNotes: "",
          warmupTimerMs: 0,
          mainTimerMs: 0,
          weight: "80",
          checkNotes: "",
        },
      },
    };
    const result = migrateRawWorkoutSnapshot(envelope);
    expect(result.version).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.updatedAt).toBe("2026-03-10T08:00:00.000Z");
    expect(result.data["2026-03-10"].warmupNotes).toBe("notes");
  });

  it("normalises future-version envelope to current version", () => {
    const futureEnvelope = { version: 99, updatedAt: "2026-06-01T00:00:00.000Z", data: {} };
    const result = migrateRawWorkoutSnapshot(futureEnvelope);
    expect(result.version).toBe(STORAGE_SCHEMA_VERSION);
  });

  it("filters out entries with invalid structure via sanitization", () => {
    const envelope = {
      version: 1,
      updatedAt: "2026-03-10T08:00:00.000Z",
      data: {
        "2026-03-10": null,
        "2026-03-11": { date: "2026-03-11", sessionType: "swim", warmup: [], main: [], warmupNotes: "", mainNotes: "", warmupTimerMs: 0, mainTimerMs: 0, weight: "", checkNotes: "" },
      },
    };
    const result = migrateRawWorkoutSnapshot(envelope);
    expect(result.data["2026-03-11"]).toBeDefined();
  });
});

describe("migrateRawTemplateSnapshot", () => {
  it("returns sanitized defaults for null input", () => {
    const result = migrateRawTemplateSnapshot(null);
    expect(result.version).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(typeof result.updatedAt).toBe("string");
    expect(typeof result.data).toBe("object");
  });

  it("migrates legacy v0 plain templates object (no envelope) to current version", () => {
    const legacy = {
      gym: { warmup: [{ text: "Bike", target: "5 min" }], main: [] },
    };
    const result = migrateRawTemplateSnapshot(legacy);
    expect(result.version).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(result.data.gym.warmup[0].text).toBe("Bike");
  });

  it("reads current v1 envelope and preserves updatedAt and data", () => {
    const envelope = {
      version: 1,
      updatedAt: "2026-04-01T10:00:00.000Z",
      templates: TEMPLATES,
    };
    const result = migrateRawTemplateSnapshot(envelope);
    expect(result.version).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(result.updatedAt).toBe("2026-04-01T10:00:00.000Z");
    expect(result.data.gym.warmup.length).toBeGreaterThan(0);
  });

  it("normalises future-version envelope to current version", () => {
    const future = { version: 5, updatedAt: "2026-06-01T00:00:00.000Z", templates: TEMPLATES };
    const result = migrateRawTemplateSnapshot(future);
    expect(result.version).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(result.data.gym).toBeDefined();
  });

  it("falls back to empty templates when input is an array", () => {
    const result = migrateRawTemplateSnapshot([]);
    expect(result.data).toBeDefined();
  });
});

describe("migrateRawPlansSnapshot", () => {
  it("returns empty plans for null input", () => {
    const result = migrateRawPlansSnapshot(null);
    expect(result.version).toBe(PLANS_SCHEMA_VERSION);
    expect(result.data).toEqual([]);
    expect(typeof result.updatedAt).toBe("string");
  });

  it("migrates legacy v0 plain array to current version", () => {
    const legacy = [
      { id: "p1", label: "Push/Pull", sessionIds: ["gym", "rest"] },
    ];
    const result = migrateRawPlansSnapshot(legacy);
    expect(result.version).toBe(PLANS_SCHEMA_VERSION);
    expect(result.data.length).toBe(1);
    expect(result.data[0].label).toBe("Push/Pull");
  });

  it("filters out invalid plans from legacy array", () => {
    const legacy = [
      { id: "p1", label: "Valid", sessionIds: ["gym"] },
      { id: 42, label: "Bad id" },
      { label: "No id", sessionIds: [] },
    ];
    const result = migrateRawPlansSnapshot(legacy);
    expect(result.data.length).toBe(1);
    expect(result.data[0].id).toBe("p1");
  });

  it("reads current v1 envelope and preserves updatedAt and data", () => {
    const envelope = {
      version: 1,
      updatedAt: "2026-05-01T12:00:00.000Z",
      plans: [{ id: "p1", label: "My Plan", sessionIds: ["gym"] }],
    };
    const result = migrateRawPlansSnapshot(envelope);
    expect(result.version).toBe(PLANS_SCHEMA_VERSION);
    expect(result.updatedAt).toBe("2026-05-01T12:00:00.000Z");
    expect(result.data[0].id).toBe("p1");
  });

  it("returns empty plans for an envelope missing required fields", () => {
    const broken = { version: 1, updatedAt: "2026-05-01T00:00:00.000Z" };
    const result = migrateRawPlansSnapshot(broken);
    expect(result.data).toEqual([]);
  });

  it("filters out invalid plans from envelope array", () => {
    const envelope = {
      version: 1,
      updatedAt: "2026-05-01T12:00:00.000Z",
      plans: [
        { id: "p1", label: "Valid", sessionIds: ["gym"] },
        { id: "p2", label: "Missing sessionIds" },
        null,
      ],
    };
    const result = migrateRawPlansSnapshot(envelope);
    expect(result.data.length).toBe(1);
    expect(result.data[0].id).toBe("p1");
  });
});
