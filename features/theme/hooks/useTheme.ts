import { useEffect, useState } from "react";
import { AppTheme, isAppTheme, THEME_STORAGE_KEY } from "../constants/themeOptions";

interface UseThemeResult {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

/**
 * Persists selected theme and keeps document root theme attribute in sync.
 */
export function useTheme(defaultTheme: AppTheme = "editorial-sport"): UseThemeResult {
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored && isAppTheme(stored) ? stored : defaultTheme;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme };
}

