type RequiredApiEnvName =
  | "KV_REST_API_URL"
  | "KV_REST_API_TOKEN"
  | "SUPABASE_URL"
  | "SUPABASE_JWT_SECRET"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "OPENAI_API_KEY"
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

export function getSupabaseJwtSecret(): string {
  return getRequiredApiEnv("SUPABASE_JWT_SECRET");
}

export function getOpenAiApiKey(): string {
  return getRequiredApiEnv("OPENAI_API_KEY");
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