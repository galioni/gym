import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequiredApiEnv } from "./apiEnv.js";

let cached: SupabaseClient | null = null;

/**
 * Service-role client for server-only data (billing state, webhook events). It bypasses row level security, so it
 * must never be used on behalf of a user's own request data, and its key never reaches the browser.
 * Reused across invocations of a warm function instance.
 */
export function getSupabaseAdmin(): SupabaseClient {
  cached ??= createClient(getRequiredApiEnv("SUPABASE_URL"), getRequiredApiEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
