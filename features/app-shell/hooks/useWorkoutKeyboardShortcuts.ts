import { useEffect } from "react";

interface UseWorkoutKeyboardShortcutsParams {
  onJumpToday: () => void;
  onLoadTemplate: () => void;
  onDuplicatePreviousDayNotesAndWeight: () => void;
  onShowShortcuts?: () => void;
}

/**
 * Registers app-wide workout shortcuts outside editable fields.
 */
export function useWorkoutKeyboardShortcuts({
  onJumpToday,
  onLoadTemplate,
  onDuplicatePreviousDayNotesAndWeight,
  onShowShortcuts,
}: UseWorkoutKeyboardShortcutsParams): void {
  useEffect(() => {
    const isTypingTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof HTMLElement)) {
        return false;
      }
      const tag = eventTarget.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        eventTarget.isContentEditable
      );
    };

    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        onJumpToday();
      } else if (key === "l") {
        event.preventDefault();
        onLoadTemplate();
      } else if (key === "d") {
        event.preventDefault();
        onDuplicatePreviousDayNotesAndWeight();
      } else if (event.key === "?" && onShowShortcuts) {
        event.preventDefault();
        onShowShortcuts();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onJumpToday, onLoadTemplate, onDuplicatePreviousDayNotesAndWeight, onShowShortcuts]);
}
