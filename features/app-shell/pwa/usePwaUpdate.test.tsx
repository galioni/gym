import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { usePwaUpdate, type RegisterServiceWorker, type ServiceWorkerHandlers } from "./usePwaUpdate";
import { UpdateBanner } from "../../../components/UpdateBanner";

function setup(checkIntervalMs = 1000) {
  const handlers: { current?: ServiceWorkerHandlers } = {};
  const activate = vi.fn(async () => {});
  const registration = { update: vi.fn(async () => {}) } as unknown as ServiceWorkerRegistration;
  const register: RegisterServiceWorker = vi.fn((h) => {
    handlers.current = h;
    return activate;
  });
  const hook = renderHook(() => usePwaUpdate(register, checkIntervalMs));
  return { hook, handlers, activate, registration, register };
}

describe("usePwaUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with no update and registers exactly once", () => {
    const { hook, register } = setup();
    expect(hook.result.current.updateAvailable).toBe(false);
    hook.rerender();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("reports an update when a new worker is waiting", () => {
    const { hook, handlers } = setup();
    act(() => handlers.current!.onNeedRefresh());
    expect(hook.result.current.updateAvailable).toBe(true);
  });

  it("applyUpdate activates the waiting worker and reloads", () => {
    const { hook, activate } = setup();
    act(() => hook.result.current.applyUpdate());
    expect(activate).toHaveBeenCalledWith(true);
  });

  it("asks for the latest worker on a timer, not just on navigation", () => {
    const { handlers, registration } = setup(1000);
    act(() => handlers.current!.onRegistered(registration));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it("checks when the app returns to the foreground", () => {
    const { handlers, registration } = setup(60_000);
    act(() => handlers.current!.onRegistered(registration));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("does not check while offline, and survives a failed check", async () => {
    const { handlers, registration } = setup(1000);
    act(() => handlers.current!.onRegistered(registration));

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(registration.update).not.toHaveBeenCalled();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    (registration.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateBanner", () => {
  afterEach(() => cleanup());

  it("renders nothing when there is no update", () => {
    const { container } = render(<UpdateBanner visible={false} onUpdate={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers Update now when one is ready", () => {
    const onUpdate = vi.fn();
    render(<UpdateBanner visible onUpdate={onUpdate} />);
    expect(screen.getByText(/new version of Daily Grind is ready/)).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Update now" }).click());
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
