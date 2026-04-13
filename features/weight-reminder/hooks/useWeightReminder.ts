import { useState } from "react";
import { WEIGHT_REMINDER_STORAGE_KEY } from "../../../constants";

export interface WeightReminderSettings {
  enabled: boolean;
  targetTime: string; // "HH:MM" 24h
}

const DEFAULT_SETTINGS: WeightReminderSettings = {
  enabled: true,
  targetTime: "08:00",
};

function loadSettings(): WeightReminderSettings {
  try {
    const stored = localStorage.getItem(WEIGHT_REMINDER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<WeightReminderSettings>;
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
        targetTime: typeof parsed.targetTime === "string" ? parsed.targetTime : DEFAULT_SETTINGS.targetTime,
      };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function useWeightReminder() {
  const [settings, setSettings] = useState<WeightReminderSettings>(loadSettings);

  const updateSettings = (updates: Partial<WeightReminderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem(WEIGHT_REMINDER_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return { settings, updateSettings };
}
