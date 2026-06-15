import React, { useState } from "react";
import { Card } from "../../../components/ui/Card";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useAuthSession } from "../../auth/hooks/useAuthSession";

const MINUTE_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMinutes = i * 30;
  const hour = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  const ampm = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return { value: totalMinutes, label: `${h}:${min === 0 ? "00" : "30"} ${ampm}` };
});

export const PushNotificationsCard: React.FC = () => {
  const { session } = useAuthSession();
  const {
    isSupported,
    permission,
    isSubscribed,
    reminderMinuteLocal,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    updateReminderMinute,
  } = usePushNotifications();

  const [pendingMinute, setPendingMinute] = useState<number>(480); // 8:00 AM

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe(pendingMinute);
    }
  };

  if (!isSupported) {
    return (
      <Card title="Push Notifications">
        <p className="text-xs text-slate-500">
          Push notifications are not supported in this browser.
        </p>
      </Card>
    );
  }

  const displayMinute = reminderMinuteLocal ?? pendingMinute;

  return (
    <Card title="Push Notifications">
      <div className="space-y-4">
        {!session && (
          <p className="text-xs text-amber-400">Sign in to enable push notifications.</p>
        )}

        {permission === "denied" && (
          <p className="text-xs text-amber-400">
            Notifications are blocked. Enable them in your browser or OS settings.
          </p>
        )}

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <div className="flex items-center justify-between min-h-[44px]">
          <div>
            <div className="text-sm text-slate-300">Workout reminders</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Daily push notification at your chosen time
            </div>
          </div>
          <div className="flex items-center gap-2 min-h-[44px] pl-4">
            {isLoading && (
              <svg
                className="animate-spin h-4 w-4 text-slate-400 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={isSubscribed}
              onClick={() => void handleToggle()}
              disabled={isLoading || !session || permission === "denied"}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40 ${
                isSubscribed ? "bg-primary" : "bg-white/20"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
                  isSubscribed ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">Reminder time</span>
          <select
            value={displayMinute}
            onChange={(e) => {
              const m = Number(e.target.value);
              setPendingMinute(m);
              if (isSubscribed) void updateReminderMinute(m);
            }}
            disabled={isLoading}
            className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none disabled:opacity-40"
          >
            {MINUTE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-slate-500">
          Times shown in your local timezone. Notifications are sent once per day.
        </p>
      </div>
    </Card>
  );
};
