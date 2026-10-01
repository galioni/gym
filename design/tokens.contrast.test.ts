import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG AA guard for the design tokens. It parses design/tokens.css, builds the surfaces text actually sits on
 * (page, glass card, translucent exercise row, input) from the tokens, and requires 4.5:1 for text colours.
 * A token change that makes text unreadable fails here instead of in a review screenshot.
 */

type Rgb = [number, number, number];
const css = readFileSync(path.resolve(__dirname, "tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`tokens.css has no block for ${selector}`);
  const end = css.indexOf("\n}", start);
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

const rgbOf = (vars: Record<string, string>, name: string): Rgb => {
  const match = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(vars[name] ?? "");
  if (!match) throw new Error(`--${name} is not an "R G B" triple: ${vars[name]}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};
const num = (vars: Record<string, string>, name: string): number => Number(vars[name]);

const luminance = ([r, g, b]: Rgb): number => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (top: Rgb, alpha: number, bottom: Rgb): Rgb =>
  top.map((v, i) => Math.round(v * alpha + bottom[i] * (1 - alpha))) as Rgb;

const THEMES = {
  // The dark body is a near-black gradient (see --body-background-image); cards are glass over it.
  dark: { vars: block('[data-theme="editorial-sport"] {'), bodyBase: [12, 16, 24] as Rgb },
  light: { vars: block('[data-theme="apple-light"] {'), bodyBase: null },
};

const TEXT_TOKENS = ["label", "label-secondary", "label-tertiary", "danger-text", "warning-text", "success-text", "info-text", "accent-text", "primary"];

for (const [theme, { vars, bodyBase }] of Object.entries(THEMES)) {
  const page = rgbOf(vars, "color-background");
  const card = blend(rgbOf(vars, "color-surface"), num(vars, "glass-surface-opacity"), bodyBase ?? page);
  const row = blend(rgbOf(vars, "color-surface-highlight"), 0.45, card);
  const input = blend(page, 0.7, card);
  const surfaces: Record<string, Rgb> = { page, card, row, input };

  describe(`${theme} theme text contrast (WCAG AA 4.5:1)`, () => {
    for (const token of TEXT_TOKENS) {
      const color = rgbOf(vars, `color-${token}`);
      for (const [surfaceName, surface] of Object.entries(surfaces)) {
        // Tertiary text is small helper copy: it sits on the page, cards and inputs, not on exercise rows.
        if (token === "label-tertiary" && surfaceName === "row") continue;
        it(`${token} on ${surfaceName}`, () => {
          expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it("text on a primary-coloured button is readable", () => {
      expect(contrast(rgbOf(vars, "color-on-primary"), rgbOf(vars, "color-primary"))).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps the text hierarchy: label > secondary > tertiary on cards", () => {
      const onCard = (token: string) => contrast(rgbOf(vars, `color-${token}`), card);
      expect(onCard("label")).toBeGreaterThan(onCard("label-secondary"));
      expect(onCard("label-secondary")).toBeGreaterThan(onCard("label-tertiary"));
    });
  });
}
