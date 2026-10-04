import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timer } from "./Timer";

/**
 * Regression test for a defect found while building the Flutter client (fixed 2026-10-03; mobile/test/state/section_timer_test.dart
 * has the Dart side).
 *
 * Timer resets itself (stops, and takes the value as its new start) when the `initialMs` prop changes. In the app the saved
 * value flows back in as that prop (useWorkoutTracker -> WorkoutSection -> Timer), and the timer saves every 5 seconds while
 * running, so its first autosave used to stop the stopwatch. The echo of its own autosave is now recognised and ignored.
 */
function Harness({ saves = [] as number[] }: { saves?: number[] }) {
  const [ms, setMs] = useState(0);
  return (
    <Timer
      initialMs={ms}
      onSave={(value) => {
        saves.push(value);
        setMs(value);
      }}
    />
  );
}

function mount(element: React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  const label = () => container.querySelector('[role="timer"]')?.getAttribute("aria-label") ?? "";
  const press = (title: string) => act(() => (container.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click());
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { root, label, press, cleanup };
}

describe("a running timer and its own autosave", () => {
  afterEach(() => vi.useRealTimers());

  it("a running timer keeps running after its first autosave", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Harness />));
    act(() => (container.querySelector('button[title="Start"]') as HTMLButtonElement).click());
    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    const label = container.querySelector('[role="timer"]')?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/running/);
    act(() => root.unmount());
    container.remove();
  });

  it("keeps counting across several autosaves without losing time, and saves ever larger values", () => {
    const saves: number[] = [];
    const t = mount(<Harness saves={saves} />);
    t.press("Start");
    // One second at a time, as in real use: React renders between ticks.
    for (let i = 0; i < 21; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(t.label()).toMatch(/running, 00:21/);
    expect(saves).toHaveLength(4);
    expect(saves.every((value, i) => i === 0 || value > saves[i - 1])).toBe(true);
    expect(saves[3]).toBeGreaterThanOrEqual(19_000);
    t.cleanup();
  });

  it("still pauses, and a paused timer takes the saved value as is", () => {
    const t = mount(<Harness />);
    t.press("Start");
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    t.press("Pause");
    expect(t.label()).toMatch(/paused, 00:07/);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(t.label()).toMatch(/paused, 00:07/);
    t.cleanup();
  });

  it("a value that comes from outside (another day, another device) still resets a running timer", () => {
    function Outside() {
      const [ms, setMs] = useState(0);
      return (
        <>
          <button title="elsewhere" onClick={() => setMs(90_000)} />
          <Timer initialMs={ms} onSave={() => undefined} />
        </>
      );
    }
    const t = mount(<Outside />);
    t.press("Start");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(t.label()).toMatch(/running/);
    t.press("elsewhere");
    expect(t.label()).toMatch(/paused, 01:30/);
    t.cleanup();
  });

  it("after a reset and a restart it keeps running through its autosaves", () => {
    const t = mount(<Harness />);
    t.press("Start");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    t.press("Reset");
    expect(t.label()).toMatch(/paused, 00:00/);
    t.press("Start");
    for (let i = 0; i < 11; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(t.label()).toMatch(/running, 00:11/);
    t.cleanup();
  });
});
