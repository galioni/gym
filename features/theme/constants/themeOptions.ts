export type AppTheme = "editorial-sport" | "industrial-dark" | "recovery-light";

export const THEME_STORAGE_KEY = "daily-workout-tracker:theme";

export const APP_THEME_OPTIONS: Array<{ value: AppTheme; label: string }> = [
  { value: "editorial-sport", label: "Editorial Sport" },
  { value: "industrial-dark", label: "Industrial Dark" },
  { value: "recovery-light", label: "Recovery Light" },
];

export function isAppTheme(value: string): value is AppTheme {
  return APP_THEME_OPTIONS.some((option) => option.value === value);
}

