import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiModelForProvider, getAiModelId, getEnabledProviders, getRequiredApiEnv } from "./apiEnv";

describe("apiEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails fast when a required variable is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(() => getRequiredApiEnv("SUPABASE_URL")).toThrow(
      "Missing required env var: SUPABASE_URL"
    );
  });
});
describe("AI model ids", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults Google to a model that has not been shut down", () => {
    vi.stubEnv("AI_MODEL_GOOGLE", "");
    // gemini-2.0-flash was retired on 2026-06-01.
    expect(getAiModelId("google")).not.toMatch(/^gemini-2\.0/);
    expect(getAiModelId("google")).toBe("gemini-3.6-flash");
  });

  it("lets a variable replace a provider's model without a code change", () => {
    vi.stubEnv("AI_MODEL_GOOGLE", "  gemini-next  ");
    expect(getAiModelId("google")).toBe("gemini-next");
    expect(getAiModelId("openai")).toBe("gpt-4o-mini");
  });

  it("builds the real provider model with the chosen id", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "fake");
    vi.stubEnv("AI_MODEL_GOOGLE", "");
    expect((getAiModelForProvider("google") as { modelId: string }).modelId).toBe("gemini-3.6-flash");
    vi.stubEnv("AI_MODEL_GOOGLE", "gemini-other");
    expect((getAiModelForProvider("google") as { modelId: string }).modelId).toBe("gemini-other");
  });
});

describe("enabled AI providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is always Google, whatever else is listed", () => {
    vi.stubEnv("AI_EXTRA_PROVIDERS", "");
    expect(getEnabledProviders()).toEqual(["google"]);
  });

  it("offers a listed extra provider only when its API key is set", () => {
    vi.stubEnv("AI_EXTRA_PROVIDERS", "anthropic,openai");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(getEnabledProviders()).toEqual(["google", "anthropic"]);

    vi.stubEnv("OPENAI_API_KEY", "key");
    expect(getEnabledProviders()).toEqual(["google", "anthropic", "openai"]);
  });

  it("does not offer a provider that has a key but is not listed", () => {
    vi.stubEnv("AI_EXTRA_PROVIDERS", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    expect(getEnabledProviders()).toEqual(["google"]);
  });

  it("ignores unknown names and stray spaces", () => {
    vi.stubEnv("AI_EXTRA_PROVIDERS", " anthropic , mistral ");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    expect(getEnabledProviders()).toEqual(["google", "anthropic"]);
  });
});
