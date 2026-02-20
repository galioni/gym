import { getRequiredSupabaseJwtEnv } from "./apiEnv.js";

interface VerifiedSupabaseUser {
  id: string;
  email: string | null;
}

export async function verifySupabaseJwt(
  accessToken: string
): Promise<VerifiedSupabaseUser | null> {
  const env = getRequiredSupabaseJwtEnv();
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: env.supabaseAnonKey,
    },
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Supabase JWT verification failed: ${response.status}`);
  }

  const payload = (await response.json()) as { id?: unknown; email?: unknown };
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    return null;
  }

  return {
    id: payload.id,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}
