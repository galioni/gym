import React, { useCallback, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog/ConfirmDialog";
import { ToastViewport } from "../components/ToastViewport/ToastViewport";
import {
  ConfirmOptions,
  FeedbackContextValue,
  ToastMessage,
  ToastOptions,
} from "../types/feedbackTypes";

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface FeedbackProviderProps {
  children: React.ReactNode;
}

export const FeedbackContext = React.createContext<FeedbackContextValue | undefined>(undefined);

/**
 * Provides app-wide confirm and toast APIs so UI flows stay non-blocking on mobile.
 */
export const FeedbackProvider: React.FC<FeedbackProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tone = options.tone ?? "info";
    const durationMs = options.durationMs ?? (tone === "error" ? 4600 : 3000);
    setToasts((current) => [...current, { ...options, id, tone, durationMs }].slice(-4));
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPendingConfirm((current) => {
        if (current) {
          current.resolve(false);
        }
        return { ...options, resolve };
      });
    });
  }, []);

  const closeConfirm = useCallback((isConfirmed: boolean) => {
    setPendingConfirm((current) => {
      if (!current) {
        return current;
      }
      current.resolve(isConfirmed);
      return null;
    });
  }, []);

  const value = useMemo<FeedbackContextValue>(
    () => ({
      showToast,
      confirm,
    }),
    [showToast, confirm]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <ConfirmDialog
        isOpen={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Confirm"}
        cancelLabel={pendingConfirm?.cancelLabel ?? "Cancel"}
        tone={pendingConfirm?.tone ?? "default"}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
    </FeedbackContext.Provider>
  );
};
