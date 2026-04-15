import React, { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { ToastAction, ToastMessage } from "../../types/feedbackTypes";

interface ToastViewportProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const toneStyles: Record<
  ToastMessage["tone"],
  { border: string; icon: React.ReactNode; text: string }
> = {
  success: {
    border: "border-accent/45",
    icon: <CheckCircle2 size={16} className="text-accent" />,
    text: "text-slate-100",
  },
  error: {
    border: "border-danger/45",
    icon: <AlertCircle size={16} className="text-red-300" />,
    text: "text-slate-100",
  },
  info: {
    border: "border-primary/45",
    icon: <Info size={16} className="text-primary" />,
    text: "text-slate-100",
  },
};

const ToastActionButton: React.FC<{ action: ToastAction; onDismiss: () => void }> = ({ action, onDismiss }) => (
  <button
    type="button"
    onClick={() => { action.onClick(); onDismiss(); }}
    className="mt-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
  >
    {action.label}
  </button>
);

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      onDismiss(toast.id);
    }, toast.durationMs);
    return () => window.clearTimeout(timerId);
  }, [toast.id, toast.durationMs, onDismiss]);

  const style = toneStyles[toast.tone];
  const isError = toast.tone === "error";

  return (
    <div
      className={`glass-panel rounded-xl border ${style.border} px-3 py-2.5 shadow-[0_18px_32px_rgba(0,0,0,0.35)]`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{style.icon}</div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${style.text}`}>{toast.title}</div>
          {toast.description && (
            <div className="mt-0.5 text-xs leading-relaxed text-slate-300">{toast.description}</div>
          )}
          {toast.action && (
            <ToastActionButton action={toast.action} onDismiss={() => onDismiss(toast.id)} />
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="h-9 w-9 shrink-0 rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <X size={14} className="mx-auto" />
        </button>
      </div>
    </div>
  );
};

/**
 * Hosts non-blocking feedback messages in a consistent corner viewport.
 */
export const ToastViewport: React.FC<ToastViewportProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <aside className="pointer-events-none fixed inset-x-0 top-3 z-[95] px-3 sm:top-4 sm:right-4 sm:left-auto sm:w-[360px] sm:px-0">
      <div className="pointer-events-auto space-y-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </aside>
  );
};
