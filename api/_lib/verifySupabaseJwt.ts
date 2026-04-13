import { jwtVerify } from "jose";
import { getSupabaseJwtSecret, getRequiredApiEnv } from "./apiEnv.js";

interface VerifiedSupabaseUser {
  id: string;
  email: string | null;
}

export async function verifySupabaseJwt(
  accessToken: string
): Promise<VerifiedSupabaseUser | null> {
  const jwtSecret = getSupabaseJwtSecret();
  const supabaseUrl = getRequiredApiEnv("SUPABASE_URL");

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(accessToken, secret, {
      audience: "authenticated",
      issuer: `${supabaseUrl}/auth/v1`,
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }

    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    };
  } catch {
    return null;
  }
}
