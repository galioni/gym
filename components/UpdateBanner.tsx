import { RefreshCw } from "lucide-react";

interface UpdateBannerProps {
  visible: boolean;
  onUpdate: () => void;
}

export function UpdateBanner({ visible, onUpdate }: UpdateBannerProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary/10 border-b border-primary/20 px-4 py-2 text-xs text-label font-medium"
    >
      <span className="inline-flex items-center gap-2">
        <RefreshCw size={13} className="shrink-0" aria-hidden="true" />
        A new version of Daily Grind is ready. Your data is saved on this device.
      </span>
      <button
        type="button"
        onClick={onUpdate}
        className="rounded-full bg-primary px-3 py-1 font-semibold text-onPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        Update now
      </button>
    </div>
  );
}
