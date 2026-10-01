import React, { useId, useRef } from "react";
import { Button } from "../../../../components/ui/Button";
import { ConfirmTone } from "../../types/feedbackTypes";
import { useModalFocus } from "../../../app-shell/hooks/useModalFocus";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Renders a lightweight confirm modal to replace blocking browser dialogs.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalFocus(isOpen, dialogRef, onCancel);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-scrim backdrop-blur-sm"
        aria-label="Close confirmation dialog"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl border border-borderStrong bg-background/95 p-5 shadow-pop"
      >
        <h3 id={titleId} className="display-title text-2xl text-label tracking-[0.04em]">
          {title}
        </h3>
        {description && (
          <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-labelSecondary">
            {description}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="w-full min-h-11 sm:w-auto sm:min-w-[112px]"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            className="w-full min-h-11 sm:w-auto sm:min-w-[112px]"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
