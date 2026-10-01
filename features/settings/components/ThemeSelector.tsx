import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../../utils";
import {
  readThemePreference,
  saveThemePreference,
  watchSystemTheme,
  type ThemePreference,
} from "../theme/themePreference";

const OPTIONS: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

export const ThemeSelector: React.FC = () => {
  const [preference, setPreference] = React.useState<ThemePreference>(readThemePreference);

  React.useEffect(() => watchSystemTheme(), []);

  const select = (next: ThemePreference) => {
    setPreference(next);
    saveThemePreference(next);
  };

  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-xl bg-fill/10 p-1">
      {OPTIONS.map(({ id, label, Icon }) => {
        const selected = preference === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => select(id)}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              selected ? "bg-surface text-label shadow-sm" : "text-labelSecondary hover:text-label"
            )}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
};
