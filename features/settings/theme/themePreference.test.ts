import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  THEME_STORAGE_KEY,
} from "./themePreference";

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
}

function mockSystemDark(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe("themePreference", () => {
  beforeEach(() => {
    stubStorage();
    document.head.innerHTML =
      '<meta name="theme-color" content="#F2F2F7"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
    document.documentElement.setAttribute("data-theme", "apple-light");
    mockSystemDark(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to light when nothing is stored or the stored value is invalid", () => {
    expect(readThemePreference()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readThemePreference()).toBe("light");
  });

  it("resolves system from the OS scheme", () => {
    expect(resolveTheme("system")).toBe("light");
    mockSystemDark(true);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("applies dark to the root attribute and browser chrome", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("editorial-sport");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#0f172a");
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content")
    ).toBe("black-translucent");
  });

  it("loads the dark webfonts once, only when dark is applied", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="dg-dark-fonts" content="https://fonts.example/css2?family=X">');
    applyTheme("light");
    expect(document.getElementById("dg-fonts")).toBeNull();
    applyTheme("dark");
    applyTheme("dark");
    expect(document.querySelectorAll("#dg-fonts")).toHaveLength(1);
    expect(document.getElementById("dg-fonts")?.getAttribute("href")).toBe("https://fonts.example/css2?family=X");
  });

  it("persists the choice and applies it", () => {
    saveThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("editorial-sport");
    saveThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("apple-light");
  });
});
