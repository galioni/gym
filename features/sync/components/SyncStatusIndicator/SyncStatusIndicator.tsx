import React from "react";
import { CloudCheck, CloudOff, RefreshCw, TriangleAlert, Cloud } from "lucide-react";
import { SyncStatus, SyncStatusKind } from "../../../../application/sync/syncStatus";
import { cn } from "../../../../utils";

const ICON: Record<SyncStatusKind, React.ReactNode> = {
  attention: <TriangleAlert size={16} aria-hidden="true" />,
  offline: <CloudOff size={16} aria-hidden="true" />,
  syncing: <RefreshCw size={16} className="animate-spin" aria-hidden="true" />,
  synced: <CloudCheck size={16} aria-hidden="true" />,
  idle: <Cloud size={16} aria-hidden="true" />,
};

const TONE: Record<SyncStatusKind, string> = {
  attention: "text-warningText",
  offline: "text-labelSecondary",
  syncing: "text-primary",
  synced: "text-successText",
  idle: "text-labelSecondary",
};

interface SyncStatusIndicatorProps {
  status: SyncStatus;
  /** Opens the sync details (Settings). */
  onClick: () => void;
  /** Show the short label next to the icon (desktop); the icon alone is used on small screens. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Always-visible sync state, so a failing or offline sync is never silent. It is a button: tapping it opens
 * Settings, where the details and any conflicts live. The label is announced politely to screen readers.
 */
export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({ status, onClick, showLabel = false, className }) => (
  <button
    type="button"
    onClick={onClick}
    title={`${status.label}: ${status.detail}`}
    aria-label={`Sync status: ${status.label}. ${status.detail}`}
    className={cn(
      "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors",
      "hover:bg-fill/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      TONE[status.kind],
      className
    )}
  >
    {ICON[status.kind]}
    {showLabel && <span>{status.label}</span>}
    <span role="status" aria-live="polite" className="sr-only">
      {status.label}
    </span>
  </button>
);
