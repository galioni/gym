import { describe, expect, it } from "vitest";
import { createEmptyDay } from "../../../utils";
import {
  applyDayUpdates,
  clearDayKeepingSession,
  deleteItemInSection,
  resetSectionsFromTemplate,
  toggleItemInSection,
} from "./WorkoutStateTransitions";

describe("WorkoutStateTransitions", () => {
  it("applies partial updates without mutating unrelated fields", () => {
    const day = createEmptyDay("2026-02-17", "tennis");
    const updated = applyDayUpdates(day, { warmupNotes: "Felt good" });

    expect(updated.warmupNotes).toBe("Felt good");
    expect(updated.mainNotes).toBe(day.mainNotes);
    expect(updated.sessionType).toBe(day.sessionType);
  });

  it("toggles a warmup item state", () => {
    const day = createEmptyDay("2026-02-17", "tennis");
    const id = day.warmup[0].id;

    const updated = toggleItemInSection(day, "warmup", id, true);

    expect(updated.warmup.find((item) => item.id === id)?.done).toBe(true);
  });

  it("deletes an item from main section", () => {
    const day = createEmptyDay("2026-02-17", "tennis");
    const id = day.main[0].id;

    const updated = deleteItemInSection(day, "main", id);

    expect(updated.main.some((item) => item.id === id)).toBe(false);
    expect(updated.main.length).toBe(day.main.length - 1);
  });

  it("resets sections from template and keeps check-in fields", () => {
    const day = createEmptyDay("2026-02-17", "gym");
    day.warmupNotes = "keep warmup notes";
    day.mainNotes = "keep main notes";
    day.weight = "79.5";
    day.checkNotes = "sleep ok";

    const updated = resetSectionsFromTemplate("2026-02-17", "gym", day);

    expect(updated.warmupNotes).toBe("keep warmup notes");
    expect(updated.mainNotes).toBe("keep main notes");
    expect(updated.weight).toBe("79.5");
    expect(updated.checkNotes).toBe("sleep ok");
    expect(updated.warmupTimerMs).toBe(0);
    expect(updated.mainTimerMs).toBe(0);
  });

  it("clears day while keeping the provided session type", () => {
    const cleared = clearDayKeepingSession("2026-02-17", "swim");

    expect(cleared.sessionType).toBe("swim");
    expect(cleared.date).toBe("2026-02-17");
  });
});

