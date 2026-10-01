import { describe, expect, it } from "vitest";
import { resolveAiProvider } from "./aiProvider";

describe("resolveAiProvider", () => {
  const all = ["google", "anthropic", "openai"] as const;

  it("uses the saved choice for a Pro user when that provider is switched on", () => {
    expect(resolveAiProvider("anthropic", true, all)).toBe("anthropic");
  });

  it("ignores a saved non-default choice for a free user (the column is writable by the user, so this is the real gate)", () => {
    expect(resolveAiProvider("anthropic", false, all)).toBe("google");
  });

  it("falls back to the default when the provider has been switched off", () => {
    expect(resolveAiProvider("openai", true, ["google", "anthropic"])).toBe("google");
  });

  it("defaults to google when nothing was saved", () => {
    expect(resolveAiProvider(undefined, true, all)).toBe("google");
    expect(resolveAiProvider(undefined, false, all)).toBe("google");
  });
});
