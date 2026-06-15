import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getRequiredApiEnv } from "./apiEnv.js";

interface VerifiedSupabaseUser {
  id: string;
  email: string | null;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      getRequiredApiEnv("SUPABASE_URL"),
      getRequiredApiEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return adminClient;
}

export async function verifySupabaseJwt(
  accessToken: string
): Promise<VerifiedSupabaseUser | null> {
  try {
    const { data: { user }, error } = await getAdminClient().auth.getUser(accessToken);
    if (error || !user) {
      console.error("[auth] Token verification failed:", error?.message ?? "no user returned");
      return null;
    }
    return { id: user.id, email: user.email ?? null };
  } catch (err) {
    console.error("[auth] Token verification failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
