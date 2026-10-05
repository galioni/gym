import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./_lib/authContext.js";
import { ApiRequest, ApiResponse, setCorsHeaders, handlePreflight, parseJsonBody } from "./_lib/http.js";
import { attachApiRequestObservability } from "./_lib/observability.js";
import { getRequiredApiEnv } from "./_lib/apiEnv.js";
import { AppleSignInError, exchangeAuthorizationCode, getAppleSignInConfig, saveAppleRefreshToken } from "./_lib/appleSignIn.js";

const MAX_CODE_LENGTH = 2048;

/**
 * POST /api/apple-token { authorizationCode }
 *
 * Called by the mobile app right after someone signs in with Apple. The code is exchanged for a refresh token that is kept only so
 * it can be revoked when the account is deleted (api/delete-account). Answers 503 until Sign in with Apple is configured; the app
 * ignores any failure here, because signing in must never depend on it.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const observation = attachApiRequestObservability(req, res, "/api/apple-token");
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    observation.setUserId(auth.userId);

    const body = parseJsonBody<Record<string, unknown>>(req, {});
    const code = body.authorizationCode;
    if (typeof code !== "string" || code.length === 0 || code.length > MAX_CODE_LENGTH) {
      res.status(400).json({ error: "Invalid authorizationCode." });
      return;
    }

    const config = getAppleSignInConfig();
    if (!config) {
      res.status(503).json({ error: "Sign in with Apple is not set up on the server yet." });
      return;
    }

    // Only for accounts that really signed in with Apple: the token must be this person's own.
    const admin = createClient(getRequiredApiEnv("SUPABASE_URL"), getRequiredApiEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.getUserById(auth.userId);
    if (error) throw new Error(`Could not read the user: ${error.message}`);
    const appleIdentity = data.user?.identities?.find((identity) => identity.provider === "apple");
    if (!appleIdentity) {
      res.status(403).json({ error: "This account does not use Sign in with Apple." });
      return;
    }

    let tokens;
    try {
      tokens = await exchangeAuthorizationCode(code, config);
    } catch (error) {
      if (error instanceof AppleSignInError && error.reason === "rejected") {
        res.status(400).json({ error: "Apple did not accept that code." });
        return;
      }
      throw error;
    }
    // The code was issued to the Apple account that is signed in here, not to some other one.
    if (tokens.appleUserId && appleIdentity.identity_data?.sub && tokens.appleUserId !== appleIdentity.identity_data.sub) {
      res.status(403).json({ error: "That code belongs to a different Apple account." });
      return;
    }

    await saveAppleRefreshToken(auth.userId, tokens.refreshToken, admin);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ ok: true });
  } catch (error) {
    observation.logUnhandledError(error);
    res.status(500).json({ error: "Internal server error", requestId: observation.requestId });
  }
}
