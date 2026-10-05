import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Sign in with Apple, server side. The app signs people in itself (Supabase checks Apple's identity token); this exists for one
 * rule: an app that offers Sign in with Apple must revoke the person's Apple token when they delete their account.
 *
 *   sign-in   the app sends the one-time authorization code Apple returned -> we exchange it for a refresh token and keep it
 *   deletion  we send that refresh token back to Apple's revoke endpoint, then the account (and the stored token) is deleted
 *
 * Everything is off until configured: with no key the endpoint answers 503 and deleting an account simply skips the revocation.
 */

export interface AppleSignInConfig {
  /** Membership details of the Apple developer account. */
  teamId: string;
  /** The key created under Certificates, Identifiers & Profiles > Keys with "Sign in with Apple" ticked (NOT the in-app purchase key). */
  keyId: string;
  /** The .p8 contents. */
  privateKey: string;
  /** The iOS bundle id: for a native app it is the client id. */
  clientId: string;
}

function read(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getAppleSignInConfig(): AppleSignInConfig | null {
  const teamId = read("APPLE_SIGNIN_TEAM_ID");
  const keyId = read("APPLE_SIGNIN_KEY_ID");
  const privateKey = read("APPLE_SIGNIN_PRIVATE_KEY");
  const clientId = read("APPLE_BUNDLE_ID");
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey: privateKey.replace(/\\n/g, "\n"), clientId };
}

type FetchLike = typeof fetch;

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** The "client secret" Apple wants: a short-lived ES256 JWT signed with our key. */
export function appleClientSecret(config: AppleSignInConfig, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: config.teamId, iat: issuedAt, exp: issuedAt + 5 * 60, aud: "https://appleid.apple.com", sub: config.clientId })
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(signature)}`;
}

export class AppleSignInError extends Error {
  constructor(
    readonly reason: "rejected" | "unavailable",
    message: string
  ) {
    super(message);
  }
}

export interface AppleTokens {
  refreshToken: string;
  /** Apple's stable id for this person (the `sub` of the identity token). */
  appleUserId: string | null;
}

function subjectOf(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    // The token comes straight from Apple over TLS in answer to our own request, so it is read as is.
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/** Trades the one-time authorization code from the app for a refresh token. A code works once and expires in minutes. */
export async function exchangeAuthorizationCode(
  code: string,
  config: AppleSignInConfig,
  deps: { fetch?: FetchLike; now?: () => number } = {}
): Promise<AppleTokens> {
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: appleClientSecret(config, (deps.now ?? Date.now)()),
      code,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (response.status >= 400 && response.status < 500) throw new AppleSignInError("rejected", "Apple did not accept the authorization code.");
  if (!response.ok) throw new AppleSignInError("unavailable", `Apple token exchange failed (${response.status})`);
  const body = (await response.json()) as { refresh_token?: unknown; id_token?: unknown };
  if (typeof body.refresh_token !== "string" || body.refresh_token.length === 0) {
    throw new AppleSignInError("rejected", "Apple returned no refresh token.");
  }
  return { refreshToken: body.refresh_token, appleUserId: subjectOf(body.id_token) };
}

/** Tells Apple the person's Sign in with Apple grant for this app is over. */
export async function revokeRefreshToken(
  refreshToken: string,
  config: AppleSignInConfig,
  deps: { fetch?: FetchLike; now?: () => number } = {}
): Promise<void> {
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: appleClientSecret(config, (deps.now ?? Date.now)()),
      token: refreshToken,
      token_type_hint: "refresh_token",
    }).toString(),
  });
  if (!response.ok) throw new AppleSignInError(response.status < 500 ? "rejected" : "unavailable", `Apple revoke failed (${response.status})`);
}

// --- storage (table apple_auth_tokens, server only) ---------------------------------------------------------------------

export async function saveAppleRefreshToken(userId: string, refreshToken: string, db: SupabaseClient = getSupabaseAdmin()): Promise<void> {
  const { error } = await db.from("apple_auth_tokens").upsert({ user_id: userId, refresh_token: refreshToken }, { onConflict: "user_id" });
  if (error) throw new Error(`Could not save Apple token: ${error.message}`);
}

export async function getAppleRefreshToken(userId: string, db: SupabaseClient = getSupabaseAdmin()): Promise<string | null> {
  const { data, error } = await db.from("apple_auth_tokens").select("refresh_token").eq("user_id", userId).maybeSingle<{ refresh_token: string }>();
  if (error) throw new Error(`Could not read Apple token: ${error.message}`);
  return data?.refresh_token ?? null;
}

/**
 * Account deletion: revoke the person's Apple grant. Never throws (deleting an account must not fail because Apple is unreachable);
 * returns what happened, for the log.
 *
 * Two ways to get the token to revoke, in this order:
 *   1. a FRESH authorization code, which the app asks Apple for when the person deletes their account. It works for every account,
 *      including ones created before this was set up, and needs no stored token;
 *   2. the refresh token stored at sign-in (when the person declined Apple's sheet at deletion, or the app could not show it).
 * A fresh code is only used if it belongs to the Apple account this user signed in with (`appleUserId`, when we know it), so one
 * account's deletion can never revoke someone else's grant.
 */
export async function revokeAppleSignInForUser(
  userId: string,
  db: SupabaseClient = getSupabaseAdmin(),
  deps: {
    fetch?: FetchLike;
    now?: () => number;
    config?: AppleSignInConfig | null;
    authorizationCode?: string | null;
    appleUserId?: string | null;
  } = {}
): Promise<"not_configured" | "no_token" | "revoked" | "failed"> {
  const config = deps.config === undefined ? getAppleSignInConfig() : deps.config;
  if (!config) return "not_configured";
  try {
    if (deps.authorizationCode) {
      try {
        const tokens = await exchangeAuthorizationCode(deps.authorizationCode, config, deps);
        if (deps.appleUserId && tokens.appleUserId && tokens.appleUserId !== deps.appleUserId) {
          console.error("[apple-signin] the fresh code belongs to a different Apple account; ignored");
        } else {
          await revokeRefreshToken(tokens.refreshToken, config, deps);
          return "revoked";
        }
      } catch (error) {
        // An expired or used code, or Apple being down: fall back to the stored token.
        console.error("[apple-signin] could not use the fresh code", error instanceof Error ? error.message : String(error));
      }
    }
    const token = await getAppleRefreshToken(userId, db);
    if (!token) return "no_token";
    await revokeRefreshToken(token, config, deps);
    return "revoked";
  } catch (error) {
    console.error("[apple-signin] revocation failed (non-fatal)", error instanceof Error ? error.message : String(error));
    return "failed";
  }
}
