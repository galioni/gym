import { useEffect } from "react";

interface UseWorkoutKeyboardShortcutsParams {
  onJumpToday: () => void;
  onResetFromTemplate: () => void;
  onDuplicatePreviousDayNotesAndWeight: () => boolean;
}

/**
 * Registers app-wide workout shortcuts outside editable fields.
 */
export function useWorkoutKeyboardShortcuts({
  onJumpToday,
  onResetFromTemplate,
  onDuplicatePreviousDayNotesAndWeight,
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
        if (confirm("This will overwrite the current list items. Continue?")) {
          onResetFromTemplate();
        }
      } else if (key === "d") {
        event.preventDefault();
        const duplicated = onDuplicatePreviousDayNotesAndWeight();
        if (!duplicated) {
          alert("No previous day data found to duplicate.");
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onJumpToday, onResetFromTemplate, onDuplicatePreviousDayNotesAndWeight]);
}
