import { GoTrueClient } from "@supabase/auth-js";
import { getRequiredSupabaseClientEnv } from "./supabaseEnv";

let cachedClient: GoTrueClient | null = null;

export function createSupabaseClient(): GoTrueClient {
  if (cachedClient) {
    return cachedClient;
  }
  const env = getRequiredSupabaseClientEnv();
  cachedClient = new GoTrueClient({
    url: `${env.url}/auth/v1`,
    headers: {
      Authorization: `Bearer ${env.anonKey}`,
      apikey: env.anonKey,
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  });
  return cachedClient;
}
