import React, { act, useRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalFocus } from "./useModalFocus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useModalFocus(open, ref, onClose);
  return (
    <div>
      <button id="trigger">trigger</button>
      {open && (
        <div ref={ref} tabIndex={-1} role="dialog">
          <button id="first">first</button>
          <button id="last">last</button>
        </div>
      )}
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement;

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));
  });
const flushFrames = () => act(async () => { await vi.advanceTimersByTimeAsync(50); });
const render = (open: boolean, onClose: () => void) =>
  act(() => root!.render(<Harness open={open} onClose={onClose} />));

describe("useModalFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    root = null;
    vi.useRealTimers();
  });

  it("moves focus to the first focusable element on open", async () => {
    render(false, vi.fn());
    render(true, vi.fn());
    await flushFrames();
    expect(document.activeElement?.id).toBe("first");
  });

  it("wraps Tab from last to first and Shift+Tab from first to last", async () => {
    render(true, vi.fn());
    await flushFrames();
    document.getElementById("last")!.focus();
    press("Tab");
    expect(document.activeElement?.id).toBe("first");
    press("Tab", { shiftKey: true });
    expect(document.activeElement?.id).toBe("last");
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(true, onClose);
    await flushFrames();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus when the onClose identity changes while open", async () => {
    render(true, vi.fn());
    await flushFrames();
    document.getElementById("last")!.focus();
    render(true, vi.fn());
    await flushFrames();
    expect(document.activeElement?.id).toBe("last");
  });

  it("restores focus to the trigger on close and ignores keys while closed", async () => {
    const trigger = () => document.getElementById("trigger")!;
    render(false, vi.fn());
    trigger().focus();
    const onClose = vi.fn();
    render(true, onClose);
    await flushFrames();
    expect(document.activeElement?.id).toBe("first");
    render(false, onClose);
    await flushFrames();
    expect(document.activeElement).toBe(trigger());
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });
});
