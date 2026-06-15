import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

type RequiredApiEnvName =
  | "KV_REST_API_URL"
  | "KV_REST_API_TOKEN"
  | "SUPABASE_URL"
  | "SUPABASE_JWT_SECRET"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_PRO_PRICE_ID";

type OptionalKvAliasName = "STORAGE_KV_REST_API_URL" | "STORAGE_KV_REST_API_TOKEN";

export interface RequiredVercelKvEnv {
  kvRestApiUrl: string;
  kvRestApiToken: string;
}


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

function getRequiredKvEnv(primaryName: RequiredApiEnvName, aliasName: OptionalKvAliasName): string {
  const primaryValue = readRequiredEnvValue(primaryName);
  if (primaryValue) {
    return primaryValue;
  }

  const aliasValue = readRequiredEnvValue(aliasName);
  if (aliasValue) {
    // Vercel-managed KV integrations now expose STORAGE_KV_* names by default.
    // Keep the fallback here so existing handlers work without duplicating env vars.
    return aliasValue;
  }

  throw new Error(`Missing required env var: ${primaryName} (or ${aliasName})`);
}

/**
 * Returns the minimum Upstash KV variables required by sync API handlers.
 */
export function getRequiredVercelKvEnv(): RequiredVercelKvEnv {
  return {
    kvRestApiUrl: getRequiredKvEnv("KV_REST_API_URL", "STORAGE_KV_REST_API_URL"),
    kvRestApiToken: getRequiredKvEnv("KV_REST_API_TOKEN", "STORAGE_KV_REST_API_TOKEN"),
  };
}

export type AiProvider = "google" | "anthropic" | "openai";

const AI_PROVIDER_DEFAULTS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.0-flash",
};

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
  const model = AI_PROVIDER_DEFAULTS[provider];
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

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidKeys(): VapidKeys | null {
  const publicKey = readRequiredEnvValue("VAPID_PUBLIC_KEY");
  const privateKey = readRequiredEnvValue("VAPID_PRIVATE_KEY");
  const subject = readRequiredEnvValue("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function getCronSecret(): string | null {
  return readRequiredEnvValue("CRON_SECRET");
}