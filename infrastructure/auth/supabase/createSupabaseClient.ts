import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { getRequiredSupabaseClientEnv } from "./supabaseEnv";

let cachedClient: SupabaseClient | null = null;

export function createSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }
  const env = getRequiredSupabaseClientEnv();

  cachedClient = createClient(env.url, env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedClient;
}
