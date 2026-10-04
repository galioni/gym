import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkoutTracker } from "./useWorkoutTracker";
import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { WorkoutDataRepository } from "../../../interfaces/workout/WorkoutDataRepository";
import { TEMPLATES } from "../../../constants";
import { createEmptyDay, toLocalDateKey } from "../../../utils";
import { DayData } from "../../../types";

type Tracker = ReturnType<typeof useWorkoutTracker>;

/**
 * Regression test for a race found while building the Flutter client (which had it too and fixed it in WorkoutTracker.reload).
 *
 * A sync that changed local storage makes the hook re-read it. If the person acts while that read is in flight, what was read
 * is already out of date. The old guard only noticed an edit that was still waiting to be saved (typing, which is debounced);
 * an edit that saves the instant it is made (ticking an item, deleting one) had already left the queue by the time the read
 * finished, so the old data replaced it on screen, and the next edit saved that old data back over it.
 */
describe("useWorkoutTracker reloading while the person edits", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.useRealTimers();
  });

  async function setup() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const today = toLocalDateKey(new Date());
    const day: DayData = createEmptyDay(today, "gym", TEMPLATES);
    const itemId = day.main[0].id;

    let stored: Record<string, DayData> = { [today]: day };
    const reads: Array<() => void> = [];
    let holdNextRead = false;
    let holdNextWrite = false;
    const writeGates: Array<() => void> = [];
    const writes: Array<Record<string, DayData>> = [];

    const repository: WorkoutDataRepository = {
      // Reads return what was stored when they STARTED; a held read finishes later, like a slow disk or a busy main thread.
      readAll: vi.fn(async () => {
        const snapshot = structuredClone(stored);
        if (holdNextRead) {
          holdNextRead = false;
          await new Promise<void>((resolve) => reads.push(resolve));
        }
        return snapshot;
      }),
      writeAll: vi.fn(async (data: Record<string, DayData>) => {
        if (holdNextWrite) {
          holdNextWrite = false;
          await new Promise<void>((resolve) => writeGates.push(resolve));
        }
        stored = structuredClone(data);
        writes.push(structuredClone(data));
      }),
      readSnapshot: vi.fn().mockResolvedValue(null),
      writeSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const service = new WorkoutDataService(repository);

    let latest: Tracker | null = null;
    const Harness = ({ token }: { token: number }) => {
      latest = useWorkoutTracker(service, TEMPLATES, token);
      return null;
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    const rootInstance = createRoot(container);
    root = rootInstance;
    await act(async () => rootInstance.render(<Harness token={0} />));
    await act(async () => {
      await Promise.resolve();
    });

    return {
      today,
      itemId,
      writes,
      get tracker(): Tracker {
        if (!latest) throw new Error("not ready");
        return latest;
      },
      /** A sync wrote to storage: ask the hook to re-read, and keep that read open until [release]. */
      async startReload(token: number) {
        holdNextRead = true;
        await act(async () => rootInstance.render(<Harness token={token} />));
        await act(async () => {
          await Promise.resolve();
        });
      },
      /** The next save waits until [finishWrite]: a slow disk. */
      slowNextWrite() {
        holdNextWrite = true;
      },
      async finishWrite() {
        await act(async () => {
          writeGates.splice(0).forEach((resolve) => resolve());
          for (let i = 0; i < 6; i++) await Promise.resolve();
        });
      },
      async release() {
        await act(async () => {
          reads.splice(0).forEach((resolve) => resolve());
          await Promise.resolve();
          await Promise.resolve();
        });
      },
      stored: () => stored,
    };
  }

  const done = (d: DayData, id: string) => d.main.find((item) => item.id === id)?.done;

  it("an item ticked while the re-read is in flight stays ticked, and a later edit does not lose it", async () => {
    const t = await setup();
    await t.startReload(1);

    await act(async () => t.tracker.toggleItem("main", t.itemId, true));
    expect(done(t.tracker.currentDay, t.itemId)).toBe(true);

    await t.release();
    expect(done(t.tracker.currentDay, t.itemId)).toBe(true); // the old data must not replace it on screen

    // The next edit builds on what is on screen; had the tick been lost there, this save would write it back as undone.
    await act(async () => t.tracker.updateDay({ mainNotes: "after" }));
    const saved = t.stored()[t.today];
    expect(done(saved, t.itemId)).toBe(true);
    expect(saved.mainNotes).toBe("after");
  });

  it("when the edit's own save is slow, the re-read waits for it instead of reading the old data again", async () => {
    const t = await setup();
    await t.startReload(1);
    t.slowNextWrite();

    await act(async () => t.tracker.toggleItem("main", t.itemId, true)); // its save is now waiting on the disk
    await t.release(); // the first read finishes, out of date: it is discarded and the hook starts over
    expect(done(t.tracker.currentDay, t.itemId)).toBe(true);

    await t.finishWrite(); // the save lands, and only then is the data read again
    expect(done(t.tracker.currentDay, t.itemId)).toBe(true);
    expect(done(t.stored()[t.today], t.itemId)).toBe(true);
  });

  it("with no edit in the meantime, the re-read still brings in what a sync wrote", async () => {
    const t = await setup();
    // A sync (another device's change) writes to storage behind the hook's back, then signals the hook to re-read.
    const changed = structuredClone(t.stored());
    changed[t.today].mainNotes = "from another device";
    Object.assign(t.stored(), changed);

    await t.startReload(1);
    await t.release();
    expect(t.tracker.currentDay.mainNotes).toBe("from another device");
  });
});
