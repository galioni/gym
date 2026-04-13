import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTemplates } from "./useTemplates";
import { TemplateService } from "../../../application/workout/TemplateService";
import { TEMPLATES } from "../../../constants";
import { Templates } from "../../../types";

function makeService(overrides: Partial<Record<string, unknown>> = {}): TemplateService {
  return {
    loadTemplates: vi.fn().mockResolvedValue({ ...TEMPLATES }),
    saveTemplates: vi.fn().mockResolvedValue(undefined),
    getDefaultSection: vi.fn().mockReturnValue([]),
    createSessionType: vi.fn().mockReturnValue({
      status: "success",
      sessionType: "yoga",
      message: 'Session type "Yoga" added.',
      templates: { ...TEMPLATES, yoga: { warmup: [], main: [] } } as Templates,
    }),
    ...overrides,
  } as unknown as TemplateService;
}

describe("useTemplates", () => {
  it("loads templates from service on mount and sets isLoaded", async () => {
    const service = makeService();
    const { result } = renderHook(() => useTemplates(service));

    expect(result.current.isLoaded).toBe(false);
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.templates).toEqual(TEMPLATES);
    expect(service.loadTemplates).toHaveBeenCalledOnce();
  });

  it("sets isLoaded even when load throws", async () => {
    const service = makeService({
      loadTemplates: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const { result } = renderHook(() => useTemplates(service));

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.templates).toEqual(TEMPLATES);
  });

  it("saveSectionTemplate returns validation errors and does not save", async () => {
    const service = makeService();
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    let errors: ReturnType<typeof result.current.saveSectionTemplate>;
    act(() => {
      errors = result.current.saveSectionTemplate("gym", "warmup", [{ text: "", target: "" }]);
    });

    expect(errors!).toHaveLength(1);
    expect(errors![0].field).toBe("text");
    expect(service.saveTemplates).not.toHaveBeenCalled();
  });

  it("saveSectionTemplate updates state and calls service on valid rows", async () => {
    const service = makeService();
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const newRows = [{ text: "Squat", target: "3x8" }];
    act(() => {
      result.current.saveSectionTemplate("gym", "warmup", newRows);
    });

    await waitFor(() => {
      expect(result.current.templates.gym.warmup).toEqual(newRows);
    });
    expect(service.saveTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ gym: expect.objectContaining({ warmup: newRows }) })
    );
  });

  it("saveSectionTemplate sets lastError when service save fails", async () => {
    const service = makeService({
      saveTemplates: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.saveSectionTemplate("gym", "warmup", [{ text: "Squat", target: "3x8" }]);
    });

    await waitFor(() => expect(result.current.lastError).toBeTruthy());
  });

  it("undoSectionTemplate does nothing when there is no history entry", async () => {
    const service = makeService();
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const warmupBefore = result.current.templates.gym.warmup;
    act(() => {
      result.current.undoSectionTemplate("gym", "warmup");
    });

    expect(result.current.templates.gym.warmup).toEqual(warmupBefore);
    expect(service.saveTemplates).not.toHaveBeenCalled();
  });

  it("undoSectionTemplate restores the previous section value", async () => {
    const service = makeService();
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const originalWarmup = result.current.templates.gym.warmup;
    const newRows = [{ text: "Squat", target: "3x8" }];

    act(() => {
      result.current.saveSectionTemplate("gym", "warmup", newRows);
    });
    await waitFor(() => expect(result.current.templates.gym.warmup).toEqual(newRows));

    act(() => {
      result.current.undoSectionTemplate("gym", "warmup");
    });
    await waitFor(() => {
      expect(result.current.templates.gym.warmup).toEqual(originalWarmup);
    });
  });

  it("resetSectionTemplate reverts section to service default", async () => {
    const defaultRows = [{ text: "Default warmup", target: "2 min" }];
    const service = makeService({
      getDefaultSection: vi.fn().mockReturnValue(defaultRows),
    });
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.resetSectionTemplate("gym", "warmup");
    });

    await waitFor(() => {
      expect(result.current.templates.gym.warmup).toEqual(defaultRows);
    });
    expect(service.saveTemplates).toHaveBeenCalled();
  });

  it("addSessionType adds the new session type and saves", async () => {
    const service = makeService();
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    let addResult: Awaited<ReturnType<typeof result.current.addSessionType>>;
    await act(async () => {
      addResult = await result.current.addSessionType("Yoga");
    });

    expect(addResult!.status).toBe("success");
    expect(addResult!.sessionType).toBe("yoga");
    expect(result.current.templates).toHaveProperty("yoga");
    expect(service.saveTemplates).toHaveBeenCalled();
  });

  it("addSessionType returns error without updating state when creation fails", async () => {
    const service = makeService({
      createSessionType: vi.fn().mockReturnValue({
        status: "error",
        message: 'Session type "Gym" already exists.',
      }),
    });
    const { result } = renderHook(() => useTemplates(service));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    let addResult: Awaited<ReturnType<typeof result.current.addSessionType>>;
    await act(async () => {
      addResult = await result.current.addSessionType("Gym");
    });

    expect(addResult!.status).toBe("error");
    expect(result.current.templates).not.toHaveProperty("yoga");
    expect(service.saveTemplates).not.toHaveBeenCalled();
  });
});
