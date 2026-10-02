import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

type RequiredApiEnvName =
  | "SUPABASE_URL"
  | "SUPABASE_JWT_SECRET"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_PRO_PRICE_ID";

function readRequiredEnvValue(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value;
}

/**
 * Reads a required API runtime variable and fails fast when it is missing.
 */
export function getRequiredApiEnv(name: RequiredApiEnvName): string {
  const value = readRequiredEnvValue(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export type AiProvider = "google" | "anthropic" | "openai";

const AI_PROVIDER_DEFAULTS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  // gemini-2.0-flash was shut down by Google on 2026-06-01; gemini-3.6-flash is the replacement Google names for it.
  google: "gemini-3.6-flash",
};

const AI_MODEL_OVERRIDE_ENV: Record<AiProvider, string> = {
  openai: "AI_MODEL_OPENAI",
  anthropic: "AI_MODEL_ANTHROPIC",
  google: "AI_MODEL_GOOGLE",
};

/** The model id used for a provider: its AI_MODEL_<PROVIDER> variable when set (so a retired model is a setting, not a deploy of new code), else the default. */
export function getAiModelId(provider: AiProvider): string {
  return readRequiredEnvValue(AI_MODEL_OVERRIDE_ENV[provider])?.trim() || AI_PROVIDER_DEFAULTS[provider];
}

const AI_PROVIDER_KEY_ENV: Record<AiProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * Returns providers available for plan generation. Google is always included
 * (free-tier baseline). AI_EXTRA_PROVIDERS adds optional pro-only providers.
 * Example: AI_EXTRA_PROVIDERS=anthropic,openai
 */
export function getEnabledProviders(): AiProvider[] {
  const extras = (process.env.AI_EXTRA_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AiProvider => s === "anthropic" || s === "openai");
  return ["google", ...extras];
}

export function getAiModelForProvider(provider: AiProvider): LanguageModel {
  const model = getAiModelId(provider);
  const keyEnv = AI_PROVIDER_KEY_ENV[provider];
  if (!readRequiredEnvValue(keyEnv)) throw new Error(`Missing required env var: ${keyEnv}`);
  switch (provider) {
    case "openai":    return openai(model);
    case "anthropic": return anthropic(model);
    case "google":    return google(model);
  }
}

/** @deprecated Use getAiModelForProvider — this remains for backward compatibility. */
export function getAiModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? "google") as AiProvider;
  return getAiModelForProvider(provider);
}

export function getSupabaseJwtSecret(): string {
  return getRequiredApiEnv("SUPABASE_JWT_SECRET");
}

export function getStripeSecretKey(): string {
  return getRequiredApiEnv("STRIPE_SECRET_KEY");
}

export function getStripeWebhookSecret(): string {
  return getRequiredApiEnv("STRIPE_WEBHOOK_SECRET");
}

export function getStripeProPriceId(): string {
  return getRequiredApiEnv("STRIPE_PRO_PRICE_ID");
}
