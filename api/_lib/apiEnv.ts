type RequiredApiEnvName =
  | "KV_REST_API_URL"
  | "KV_REST_API_TOKEN"
  | "SUPABASE_URL"
  | "SUPABASE_ANON_KEY";

export interface RequiredVercelKvEnv {
  kvRestApiUrl: string;
  kvRestApiToken: string;
}

export interface RequiredSupabaseJwtEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/**
 * Reads a required API runtime variable and fails fast when it is missing.
 */
export function getRequiredApiEnv(name: RequiredApiEnvName): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Returns the minimum Upstash KV variables required by sync API handlers.
 */
export function getRequiredVercelKvEnv(): RequiredVercelKvEnv {
  return {
    kvRestApiUrl: getRequiredApiEnv("KV_REST_API_URL"),
    kvRestApiToken: getRequiredApiEnv("KV_REST_API_TOKEN"),
  };
}

/**
 * Returns the minimum Supabase variables required for JWT user verification.
 */
export function getRequiredSupabaseJwtEnv(): RequiredSupabaseJwtEnv {
  return {
    supabaseUrl: getRequiredApiEnv("SUPABASE_URL"),
    supabaseAnonKey: getRequiredApiEnv("SUPABASE_ANON_KEY"),
  };
}
