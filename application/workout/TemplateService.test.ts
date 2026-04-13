import { describe, expect, it, vi } from "vitest";
import { TemplateService } from "./TemplateService";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { TEMPLATES } from "../../constants";
import { Templates } from "../../types";

function makeRepository(overrides: Partial<Record<string, unknown>> = {}): TemplateRepository {
  return {
    readTemplates: vi.fn().mockResolvedValue(null),
    writeTemplates: vi.fn().mockResolvedValue(undefined),
    readSnapshot: vi.fn().mockResolvedValue(null),
    writeSnapshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TemplateRepository;
}

describe("TemplateService", () => {
  it("loadTemplates returns sanitized TEMPLATES when repository returns null", async () => {
    const service = new TemplateService(makeRepository());

    const result = await service.loadTemplates();

    expect(result).toMatchObject({ gym: expect.any(Object), tennis: expect.any(Object) });
  });

  it("loadTemplates returns sanitized data from repository", async () => {
    const storedTemplates: Templates = {
      ...TEMPLATES,
      custom: { warmup: [{ text: "Band pull-aparts", target: "2x15" }], main: [] },
    };
    const repo = makeRepository({ readTemplates: vi.fn().mockResolvedValue(storedTemplates) });
    const service = new TemplateService(repo);

    const result = await service.loadTemplates();

    expect(result.custom.warmup[0].text).toBe("Band pull-aparts");
  });

  it("saveTemplates writes sanitized templates to repository", async () => {
    const repo = makeRepository();
    const service = new TemplateService(repo);
    const rawTemplates: Templates = {
      gym: {
        warmup: [{ text: "  Bike  ", target: "  5 min  " }],
        main: [],
      },
    };

    await service.saveTemplates(rawTemplates);

    const [written] = (repo.writeTemplates as ReturnType<typeof vi.fn>).mock.calls[0] as [Templates];
    expect(written.gym.warmup[0].text).toBe("Bike");
    expect(written.gym.warmup[0].target).toBe("5 min");
  });

  it("saveTemplates strips empty-text rows; falls back to section default when all rows are empty", async () => {
    const repo = makeRepository();
    const service = new TemplateService(repo);
    // All warmup rows have empty text → sanitizeTemplates falls back to the built-in gym warmup
    await service.saveTemplates({
      gym: { warmup: [{ text: "", target: "5 min" }], main: [] },
    });

    const [written] = (repo.writeTemplates as ReturnType<typeof vi.fn>).mock.calls[0] as [Templates];
    // Falls back to default, not zero rows
    expect(written.gym.warmup.length).toBeGreaterThan(0);
    expect(written.gym.warmup.every((row) => row.text.length > 0)).toBe(true);
  });

  it("getDefaultSection returns a cloned copy of the default template section", () => {
    const service = new TemplateService(makeRepository());

    const rows = service.getDefaultSection("gym", "warmup");

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].text).toBeTruthy();
    // Mutation of the returned array should not affect subsequent calls
    rows.splice(0);
    expect(service.getDefaultSection("gym", "warmup").length).toBeGreaterThan(0);
  });

  it("createSessionType returns success result with empty template for new label", () => {
    const service = new TemplateService(makeRepository());

    const result = service.createSessionType(TEMPLATES, "Yoga Flow");

    expect(result.status).toBe("success");
    expect(result.sessionType).toBe("yoga-flow");
    expect(result.templates?.["yoga-flow"]).toEqual({ warmup: [], main: [] });
  });

  it("createSessionType returns error when label normalizes to an existing key", () => {
    const service = new TemplateService(makeRepository());

    const result = service.createSessionType(TEMPLATES, "Gym");

    expect(result.status).toBe("error");
    expect(result.message).toContain("already exists");
  });
});
