import { RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled")
  );
}

/**
 * Modal keyboard behaviour for a dialog container: moves focus inside on open,
 * keeps Tab/Shift+Tab within it, closes on Escape, and restores focus to the
 * previously focused element on close. The container should have tabIndex={-1}
 * so it can take focus when it has no focusable children.
 */
export function useModalFocus(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  // Held in a ref so a new callback identity never re-runs the effect and steals focus.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      (getFocusable(container)[0] ?? container).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      const container = containerRef.current;
      if (event.key !== "Tab" || !container) return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !container.contains(active);

      if (event.shiftKey) {
        if (outside || active === first || active === container) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        window.requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
  }, [isOpen, containerRef]);
}
