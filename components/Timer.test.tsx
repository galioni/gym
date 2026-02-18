import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timer } from "./Timer";

describe("Timer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    vi.useRealTimers();
  });

  it("autosaves while running even as display updates every tick", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const onSave = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    const rootInstance = createRoot(container);
    root = rootInstance;

    act(() => {
      rootInstance.render(<Timer initialMs={0} onSave={onSave} />);
    });

    const startButton = container.querySelector('button[title="Start"]') as HTMLButtonElement;
    act(() => {
      startButton.click();
    });

    act(() => {
      vi.advanceTimersByTime(5100);
    });

    expect(onSave).toHaveBeenCalled();
  });
});
