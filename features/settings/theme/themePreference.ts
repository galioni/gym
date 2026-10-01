export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "dg-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

const THEME_ATTRIBUTE: Record<ResolvedTheme, string> = {
  light: "apple-light",
  dark: "editorial-sport",
};

const BROWSER_CHROME: Record<ResolvedTheme, { themeColor: string; statusBar: string }> = {
  light: { themeColor: "#F2F2F7", statusBar: "default" },
  dark: { themeColor: "#0f172a", statusBar: "black-translucent" },
};

const FONTS_LINK_ID = "dg-fonts";

/** The editorial (dark) theme's webfonts; light uses the system font stack and loads none. */
function ensureDarkFonts(): void {
  if (document.getElementById(FONTS_LINK_ID)) return;
  const href = document.querySelector('meta[name="dg-dark-fonts"]')?.getAttribute("content");
  if (!href) return;
  const link = document.createElement("link");
  link.id = FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Mirrors the pre-paint script in index.html; keep the two in sync. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const chrome = BROWSER_CHROME[resolved];
  document.documentElement.setAttribute("data-theme", THEME_ATTRIBUTE[resolved]);
  if (resolved === "dark") ensureDarkFonts();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", chrome.themeColor);
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute("content", chrome.statusBar);
  return resolved;
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this session only.
  }
  applyTheme(preference);
}

/** Re-applies the theme when the OS scheme changes while the preference is "system". */
export function watchSystemTheme(): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => undefined;
  const onChange = () => {
    if (readThemePreference() === "system") applyTheme("system");
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
