import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Terms of Use and Privacy Policy are static pages (public/terms.html, public/privacy.html) that both app stores link to.
 * These tests keep them wired in and keep their key promises in line with what the product actually does.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const terms = read("public/terms.html");
const privacy = read("public/privacy.html");

/** The text a person reads, without markup. */
const plain = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("legal pages: wiring", () => {
  it("are served at /terms and /privacy, and found by search engines", () => {
    expect(JSON.parse(read("vercel.json")).cleanUrls).toBe(true);
    const sitemap = read("public/sitemap.xml");
    expect(sitemap).toContain("/terms</loc>");
    expect(sitemap).toContain("/privacy</loc>");
  });

  it("are not swallowed by the installed app's service worker", () => {
    const sw = read("src/sw.ts");
    expect(sw).toMatch(/denylist:\s*\[[^\]]*terms\|privacy/);
  });

  it("link to each other and back to the app", () => {
    expect(terms).toContain('href="/privacy"');
    expect(privacy).toContain('href="/terms"');
    expect(terms).toContain('href="/"');
    expect(privacy).toContain('href="/"');
  });

  it("are linked from the landing page and from Settings", () => {
    for (const file of ["features/landing/components/LandingPage/LandingPage.tsx", "features/settings/components/SettingsPage/SettingsPage.tsx"]) {
      const source = read(file);
      expect(source, file).toContain('href="/terms"');
      expect(source, file).toContain('href="/privacy"');
    }
  });

  it("only leave the three operator placeholders to fill in (npm run check:legal fails until they are)", () => {
    for (const html of [terms, privacy]) {
      const left = [...new Set(html.match(/\[[A-Z][A-Z ]+\]/g) ?? [])].sort();
      expect(left).toEqual(["[CONTACT EMAIL]", "[OPERATOR ADDRESS]", "[OPERATOR NAME]"]);
    }
  });
});

describe("privacy policy: says what the product does", () => {
  const text = plain(privacy);

  it("names every provider that handles data", () => {
    for (const provider of ["Supabase", "Vercel", "Stripe", "Apple", "Google Play", "Resend", "Google Fonts", "Anthropic", "OpenAI", "Gemini"]) {
      expect(text, provider).toContain(provider);
    }
  });

  it("says plainly what goes to the AI model: the questionnaire only", () => {
    expect(text).toMatch(/only the questionnaire answers/);
    expect(text).toMatch(/do not send your name, email, account id, workout history, notes or weight/);
  });

  it("describes deletion the way the app does it", () => {
    expect(text).toContain("Settings → Data → Delete account and all data");
    expect(text).toMatch(/up to 90 days/);
    expect(text).toMatch(/most recent 7 days/);
    expect(text).toMatch(/does not cancel a subscription bought through the App Store or Google Play/);
  });

  it("covers Sign in with Apple, including revoking the token on deletion", () => {
    expect(text).toMatch(/Sign in with Apple/);
    expect(text).toMatch(/revoke/);
    expect(text).toMatch(/private relay address/);
  });

  it("states what it does not do", () => {
    expect(text).toMatch(/do not sell your data/);
    expect(text).toMatch(/never receive or store your card number/);
  });
});

describe("terms of use: cover paid subscriptions in both stores", () => {
  const text = plain(terms);

  it("explain renewal, cancellation and where each purchase is managed", () => {
    expect(text).toMatch(/renews automatically/);
    expect(text).toMatch(/at least 24 hours before the end of the current period/);
    expect(text).toContain("Apple ID");
    expect(text).toContain("Google Play");
    expect(text).toContain("Stripe");
    expect(text).toMatch(/If Pro ends, nothing is deleted/);
  });

  it("carry the points Apple requires of a custom licence agreement", () => {
    expect(text).toMatch(/not Apple or Google/);
    expect(text).toMatch(/third-party beneficiaries/);
    expect(text).toMatch(/maintenance and support/);
  });

  it("include the health disclaimer", () => {
    expect(text).toMatch(/not medical advice/);
    expect(text).toMatch(/at your own risk/);
  });
});
