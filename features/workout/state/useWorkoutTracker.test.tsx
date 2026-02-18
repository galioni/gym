import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkoutTracker } from "./useWorkoutTracker";
import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { WorkoutDataRepository } from "../../../interfaces/workout/WorkoutDataRepository";
import { TEMPLATES } from "../../../constants";
import { createEmptyDay, toLocalDateKey } from "../../../utils";
import { DayData } from "../../../types";

interface TrackerTestState {
  currentDate: string;
  currentDay: DayData;
  setCurrentDate: (date: string) => void;
  duplicatePreviousDayNotesAndWeight: () => boolean;
}

describe("useWorkoutTracker", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  it("uses local date keys and duplicates previous-day notes/weight", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const date = "2026-02-18";
    const previousDate = "2026-02-17";
    const repository: WorkoutDataRepository = {
      readAll: vi.fn().mockResolvedValue({
        [previousDate]: {
          ...createEmptyDay(previousDate, "gym", TEMPLATES),
          warmupNotes: "Prev warmup",
          mainNotes: "Prev main",
          checkNotes: "Prev check",
          weight: "81.2",
        },
      }),
      writeAll: vi.fn().mockResolvedValue(undefined),
      readSnapshot: vi.fn().mockResolvedValue(null),
      writeSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const service = new WorkoutDataService(repository);
    let latest: TrackerTestState | null = null;
    const getLatest = () => {
      if (!latest) {
        throw new Error("Hook state is not ready");
      }
      return latest;
    };

    const Harness = () => {
      latest = useWorkoutTracker(service, TEMPLATES);
      return null;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    const rootInstance = createRoot(container);
    root = rootInstance;

    await act(async () => {
      rootInstance.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getLatest().currentDate).toBe(toLocalDateKey(new Date()));

    act(() => {
      getLatest().setCurrentDate(date);
    });

    let duplicated = false;
    act(() => {
      duplicated = getLatest().duplicatePreviousDayNotesAndWeight();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(duplicated).toBe(true);
    expect(getLatest().currentDay.warmupNotes).toBe("Prev warmup");
    expect(getLatest().currentDay.mainNotes).toBe("Prev main");
    expect(getLatest().currentDay.checkNotes).toBe("Prev check");
    expect(getLatest().currentDay.weight).toBe("81.2");
  });
});
