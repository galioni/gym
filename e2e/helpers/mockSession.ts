/**
 * @supabase/auth-js GoTrueClient defaults to "supabase.auth.token" as the storage key when no custom
 * storageKey is provided (see the GoTrueClient constructor / STORAGE_KEY constant).
 */
export const SUPABASE_SESSION_KEY = "supabase.auth.token";

/**
 * Builds a mock Supabase session with a far-future expiry (2030-01-01). The stored session is read by
 * Supabase JS directly from localStorage without a network call as long as
 * expires_at > Date.now()/1000 + refresh_margin, so specs can start signed in with no auth server.
 */
export function buildMockSession({ id, email }: { id: string; email: string }) {
  const b64url = (data: unknown) =>
    Buffer.from(JSON.stringify(data))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const jwt = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({
      sub: id,
      email,
      role: "authenticated",
      aud: "authenticated",
      exp: 1893456000,
      iat: 1718352000,
    }),
    "fakesig",
  ].join(".");

  return {
    access_token: jwt,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1893456000,
    refresh_token: `fake-refresh-${id}`,
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

/**
 * Every sync first asks the database whether it may go ahead (begin_sync), and the screen reads the plan's allowance
 * (sync_allowance). Specs that mock the backend must answer both, as an account with no limit would hear them. Register this
 * AFTER the catch-all route that aborts everything else, because the last matching route wins.
 */
export async function mockUnlimitedSync(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**placeholder.supabase.co/rest/v1/rpc/begin_sync*", (route) =>
    route.fulfill({ json: [{ allowed: true, window_ends_at: null, next_available_at: null }] })
  );
  await page.route("**placeholder.supabase.co/rest/v1/rpc/sync_allowance*", (route) =>
    route.fulfill({ json: [{ enforced: false, is_pro: false, window_ends_at: null, next_available_at: null }] })
  );
}
