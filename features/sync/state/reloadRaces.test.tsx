import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTemplates } from "../../templates/state/useTemplates";
import { usePlans } from "../../plans/state/usePlans";
import { TemplateService } from "../../../application/workout/TemplateService";
import { PlanService } from "../../../application/workout/PlanService";
import { TEMPLATES } from "../../../constants";
import { Plan, Templates } from "../../../types";

/**
 * A sync that changes local storage makes the hooks re-read it. A read that started BEFORE the person's edit is out of date when
 * it finishes; putting it on screen used to undo the edit, and the next save wrote the old data back (see useStaleReadGuard).
 * Same family as features/workout/state/useWorkoutTracker.reload.test.tsx.
 */

/** A promise the test settles by hand, to hold a read open. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe("useTemplates re-reading while the person edits", () => {
  function setup() {
    let stored: Templates = structuredClone(TEMPLATES);
    const held = gate();
    let holdNext = false;
    const service = {
      // Like a real read: it sees storage as it was when it STARTED, and may finish much later.
      loadTemplates: vi.fn(async () => {
        const snapshot = structuredClone(stored);
        if (holdNext) {
          holdNext = false;
          await held.opened;
        }
        return snapshot;
      }),
      saveTemplates: vi.fn(async (next: Templates) => {
        stored = structuredClone(next);
      }),
      getDefaultSection: vi.fn().mockReturnValue([]),
    } as unknown as TemplateService;
    return { service, hold: () => (holdNext = true), release: held.open, stored: () => stored };
  }

  it("an edit made while the re-read is in flight is kept on screen, and in storage", async () => {
    const t = setup();
    const { result, rerender } = renderHook(({ token }) => useTemplates(t.service, token), { initialProps: { token: 0 } });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    t.hold();
    rerender({ token: 1 }); // a sync wrote to storage: re-read (and the read is slow)
    await waitFor(() => expect(t.service.loadTemplates).toHaveBeenCalledTimes(2));

    const rows = [{ text: "Edited while syncing", target: "3x8" }];
    act(() => {
      result.current.saveSectionTemplate("gym", "warmup", rows);
    });
    expect(result.current.templates.gym.warmup).toEqual(rows);

    await act(async () => {
      t.release(); // the old read finishes
    });
    await waitFor(() => expect(t.service.loadTemplates).toHaveBeenCalledTimes(3)); // thrown away, read again
    expect(result.current.templates.gym.warmup).toEqual(rows);
    expect(t.stored().gym.warmup).toEqual(rows);
  });

  it("with no edit in the meantime, the re-read still shows what a sync wrote", async () => {
    const t = setup();
    const { result, rerender } = renderHook(({ token }) => useTemplates(t.service, token), { initialProps: { token: 0 } });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const changed = structuredClone(TEMPLATES);
    changed.gym.warmup = [{ text: "From another device", target: "" }];
    await t.service.saveTemplates(changed);
    rerender({ token: 1 });
    await waitFor(() => expect(result.current.templates.gym.warmup).toEqual(changed.gym.warmup));
    expect(t.service.loadTemplates).toHaveBeenCalledTimes(2);
  });
});

describe("usePlans re-reading while the person edits", () => {
  const plan = (id: string, label: string): Plan => ({ id, label, sessionIds: ["gym"] }) as Plan;

  function setup(initial: Plan[]) {
    let stored = [...initial];
    let activeId: string | null = null;
    const held = gate();
    let holdNext = false;
    const service = {
      getPlans: vi.fn(async () => {
        const snapshot = [...stored];
        if (holdNext) {
          holdNext = false;
          await held.opened;
        }
        return snapshot;
      }),
      getActivePlanId: vi.fn(async () => activeId),
      createPlan: vi.fn(async (label: string) => {
        const created = plan(`p${stored.length + 1}`, label);
        stored = [...stored, created];
        return created;
      }),
      deletePlan: vi.fn(async (id: string) => {
        stored = stored.filter((p) => p.id !== id);
      }),
      updatePlan: vi.fn(),
      setActivePlan: vi.fn(async (id: string | null) => {
        activeId = id;
      }),
    } as unknown as PlanService;
    return { service, hold: () => (holdNext = true), release: held.open, stored: () => stored };
  }

  it("a plan created while the re-read is in flight is not wiped out, and not duplicated", async () => {
    const t = setup([plan("p1", "Push")]);
    const { result, rerender } = renderHook(({ token }) => usePlans(t.service, token), { initialProps: { token: 0 } });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    t.hold();
    rerender({ token: 1 });
    await waitFor(() => expect(t.service.getPlans).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.createPlan("Pull", ["gym"]);
    });
    expect(result.current.plans.map((p) => p.label)).toEqual(["Push", "Pull"]);

    await act(async () => {
      t.release();
    });
    await waitFor(() => expect(t.service.getPlans).toHaveBeenCalledTimes(3));
    expect(result.current.plans.map((p) => p.label)).toEqual(["Push", "Pull"]);
  });

  it("a plan deleted while the re-read is in flight stays deleted", async () => {
    const t = setup([plan("p1", "Push"), plan("p2", "Pull")]);
    const { result, rerender } = renderHook(({ token }) => usePlans(t.service, token), { initialProps: { token: 0 } });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    t.hold();
    rerender({ token: 1 });
    await waitFor(() => expect(t.service.getPlans).toHaveBeenCalledTimes(2));
    await act(async () => {
      await result.current.deletePlan("p2");
    });
    await act(async () => {
      t.release();
    });
    await waitFor(() => expect(t.service.getPlans).toHaveBeenCalledTimes(3));
    expect(result.current.plans.map((p) => p.id)).toEqual(["p1"]);
  });
});
