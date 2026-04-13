import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageTemplateRepository } from "./LocalStorageTemplateRepository";
import { TEMPLATE_SCHEMA_VERSION, TEMPLATE_STORAGE_KEY, TEMPLATES } from "../../constants";
import { Templates } from "../../types";

function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function writeEnvelope(templates: Templates, version = 1, updatedAt = "2026-01-01T00:00:00.000Z") {
  localStorage.setItem(
    TEMPLATE_STORAGE_KEY,
    JSON.stringify({ version, updatedAt, templates })
  );
}

describe("LocalStorageTemplateRepository", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorageMock());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("readSnapshot returns null when storage is empty", async () => {
    const repo = new LocalStorageTemplateRepository();

    expect(await repo.readSnapshot()).toBeNull();
  });

  it("readSnapshot parses envelope format and preserves version and updatedAt", async () => {
    writeEnvelope(TEMPLATES, 2, "2026-03-15T10:00:00.000Z");
    const repo = new LocalStorageTemplateRepository();

    const snapshot = await repo.readSnapshot();

    expect(snapshot?.version).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(snapshot?.updatedAt).toBe("2026-03-15T10:00:00.000Z");
    expect(snapshot?.data.gym.warmup.length).toBeGreaterThan(0);
  });

  it("readSnapshot handles legacy format (plain templates object) and migrates it", async () => {
    const legacy: Templates = { gym: { warmup: [{ text: "Bike", target: "5 min" }], main: [] } };
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(legacy));
    const repo = new LocalStorageTemplateRepository();

    const snapshot = await repo.readSnapshot();

    expect(snapshot?.version).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(snapshot?.data.gym.warmup[0].text).toBe("Bike");
    // Migration writes back the envelope format
    const stored = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored).toHaveProperty("version");
    expect(stored).toHaveProperty("updatedAt");
  });

  it("readSnapshot returns null and clears storage on invalid JSON", async () => {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, "this is not json");
    const repo = new LocalStorageTemplateRepository();

    const snapshot = await repo.readSnapshot();

    expect(snapshot).toBeNull();
    expect(localStorage.getItem(TEMPLATE_STORAGE_KEY)).toBeNull();
  });

  it("writeSnapshot stores a readable envelope", async () => {
    const repo = new LocalStorageTemplateRepository();
    const now = "2026-04-01T12:00:00.000Z";

    await repo.writeSnapshot({ version: 1, updatedAt: now, data: TEMPLATES });

    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!) as Record<string, unknown>;
    expect(envelope.version).toBe(1);
    expect(envelope.updatedAt).toBe(now);
    expect(typeof envelope.templates).toBe("object");
  });

  it("readTemplates returns null when storage is empty", async () => {
    const repo = new LocalStorageTemplateRepository();

    expect(await repo.readTemplates()).toBeNull();
  });

  it("readTemplates returns the templates from a stored snapshot", async () => {
    writeEnvelope(TEMPLATES);
    const repo = new LocalStorageTemplateRepository();

    const templates = await repo.readTemplates();

    expect(templates?.gym.warmup.length).toBeGreaterThan(0);
    expect(templates?.tennis).toBeDefined();
  });

  it("writeTemplates persists templates readable by readTemplates", async () => {
    const repo = new LocalStorageTemplateRepository();
    const custom: Templates = {
      custom: { warmup: [{ text: "Band work", target: "5 min" }], main: [] },
    };

    await repo.writeTemplates(custom);
    const read = await repo.readTemplates();

    expect(read?.custom.warmup[0].text).toBe("Band work");
  });
});
