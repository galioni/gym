interface VerifiedSupabaseUser {
  id: string;
  email: string | null;
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_ANON_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function verifySupabaseJwt(
  accessToken: string
): Promise<VerifiedSupabaseUser | null> {
  const response = await fetch(`${getRequiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: getRequiredEnv("SUPABASE_ANON_KEY"),
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
