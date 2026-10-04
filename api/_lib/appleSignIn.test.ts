import crypto from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appleClientSecret,
  exchangeAuthorizationCode,
  getAppleRefreshToken,
  getAppleSignInConfig,
  revokeAppleSignInForUser,
  revokeRefreshToken,
  saveAppleRefreshToken,
  type AppleSignInConfig,
} from "./appleSignIn";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const config: AppleSignInConfig = {
  teamId: "TEAM123456",
  keyId: "KEY1234567",
  clientId: "com.example.dailygrind",
  privateKey: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const jwt = (payload: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
const form = (call: unknown[]) => new URLSearchParams((call[1] as RequestInit).body as string);

describe("getAppleSignInConfig", () => {
  const names = ["APPLE_SIGNIN_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY", "APPLE_BUNDLE_ID"] as const;
  afterEach(() => names.forEach((n) => delete process.env[n]));

  it("is off until all four values are set", () => {
    expect(getAppleSignInConfig()).toBeNull();
    process.env.APPLE_SIGNIN_TEAM_ID = "T";
    process.env.APPLE_SIGNIN_KEY_ID = "K";
    process.env.APPLE_SIGNIN_PRIVATE_KEY = "line1\\nline2";
    expect(getAppleSignInConfig()).toBeNull();
    process.env.APPLE_BUNDLE_ID = "com.example";
    expect(getAppleSignInConfig()).toEqual({ teamId: "T", keyId: "K", privateKey: "line1\nline2", clientId: "com.example" });
  });
});

describe("appleClientSecret", () => {
  it("is an ES256 JWT with Apple's claims that verifies with the public key", () => {
    const [h, c, s] = appleClientSecret(config, NOW).split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: "TEAM123456", aud: "https://appleid.apple.com", sub: "com.example.dailygrind", iat: NOW / 1000 });
    expect(claims.exp).toBeGreaterThan(claims.iat);
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("exchangeAuthorizationCode", () => {
  it("trades the code for a refresh token and reads Apple's id for the person", async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { refresh_token: "r-1", id_token: jwt({ sub: "001234.abc" }) }));
    const tokens = await exchangeAuthorizationCode("the-code", config, { fetch: f, now: () => NOW });
    expect(tokens).toEqual({ refreshToken: "r-1", appleUserId: "001234.abc" });
    expect(f.mock.calls[0][0]).toBe("https://appleid.apple.com/auth/token");
    const sent = form(f.mock.calls[0]);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("the-code");
    expect(sent.get("client_id")).toBe("com.example.dailygrind");
    expect(sent.get("client_secret")).toMatch(/^.+\..+\..+$/);
  });

  it("says rejected for a bad, used or expired code, and unavailable for an Apple outage", async () => {
    await expect(exchangeAuthorizationCode("x", config, { fetch: vi.fn().mockResolvedValue(reply(400, { error: "invalid_grant" })) })).rejects.toMatchObject({ reason: "rejected" });
    await expect(exchangeAuthorizationCode("x", config, { fetch: vi.fn().mockResolvedValue(reply(503)) })).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("does not accept an answer without a refresh token", async () => {
    await expect(exchangeAuthorizationCode("x", config, { fetch: vi.fn().mockResolvedValue(reply(200, { id_token: jwt({ sub: "a" }) })) })).rejects.toMatchObject({ reason: "rejected" });
  });
});

describe("revokeRefreshToken", () => {
  it("asks Apple to revoke it as a refresh token", async () => {
    const f = vi.fn().mockResolvedValue(reply(200));
    await revokeRefreshToken("r-9", config, { fetch: f, now: () => NOW });
    expect(f.mock.calls[0][0]).toBe("https://appleid.apple.com/auth/revoke");
    const sent = form(f.mock.calls[0]);
    expect(sent.get("token")).toBe("r-9");
    expect(sent.get("token_type_hint")).toBe("refresh_token");
  });

  it("throws when Apple refuses", async () => {
    await expect(revokeRefreshToken("r", config, { fetch: vi.fn().mockResolvedValue(reply(400)) })).rejects.toMatchObject({ reason: "rejected" });
  });
});

type Row = Record<string, unknown>;

/** The slice of the Supabase client the token store uses. */
function fakeDb(rows: Row[] = [], failWith: string | null = null) {
  const db = {
    rows,
    from: () => ({
      upsert: async (row: Row) => {
        if (failWith) return { error: { message: failWith } };
        const at = rows.findIndex((r) => r.user_id === row.user_id);
        if (at >= 0) rows[at] = { ...rows[at], ...row };
        else rows.push(row);
        return { error: null };
      },
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => (failWith ? { data: null, error: { message: failWith } } : { data: rows.find((r) => r[column] === value) ?? null, error: null }),
        }),
      }),
    }),
  };
  return db as typeof db & never;
}

describe("the stored token", () => {
  it("is kept per user and replaced, not duplicated, on the next sign-in", async () => {
    const db = fakeDb();
    await saveAppleRefreshToken("u1", "r-1", db);
    await saveAppleRefreshToken("u1", "r-2", db);
    expect(db.rows).toEqual([{ user_id: "u1", refresh_token: "r-2" }]);
    expect(await getAppleRefreshToken("u1", db)).toBe("r-2");
    expect(await getAppleRefreshToken("someone-else", db)).toBeNull();
  });

  it("reports a database failure instead of hiding it", async () => {
    await expect(saveAppleRefreshToken("u1", "r", fakeDb([], "disk full"))).rejects.toThrow(/disk full/);
    await expect(getAppleRefreshToken("u1", fakeDb([], "timeout"))).rejects.toThrow(/timeout/);
  });
});

describe("revokeAppleSignInForUser (account deletion)", () => {
  it("does nothing, and reads nothing, until Sign in with Apple is configured", async () => {
    const db = fakeDb([{ user_id: "u1", refresh_token: "r" }]);
    const f = vi.fn();
    expect(await revokeAppleSignInForUser("u1", db, { config: null, fetch: f })).toBe("not_configured");
    expect(f).not.toHaveBeenCalled();
  });

  it("revokes the person's token with Apple", async () => {
    const f = vi.fn().mockResolvedValue(reply(200));
    expect(await revokeAppleSignInForUser("u1", fakeDb([{ user_id: "u1", refresh_token: "r-1" }]), { config, fetch: f })).toBe("revoked");
    expect(form(f.mock.calls[0]).get("token")).toBe("r-1");
  });

  it("has nothing to do for someone who never signed in with Apple", async () => {
    const f = vi.fn();
    expect(await revokeAppleSignInForUser("u1", fakeDb(), { config, fetch: f })).toBe("no_token");
    expect(f).not.toHaveBeenCalled();
  });

  describe("with a fresh authorization code from the app", () => {
    const exchangeThenRevoke = (idTokenSub: string) =>
      vi
        .fn()
        .mockResolvedValueOnce(reply(200, { refresh_token: "r-fresh", id_token: jwt({ sub: idTokenSub }) }))
        .mockResolvedValueOnce(reply(200));

    it("revokes with it, so an account whose token was never stored (created before setup) is still disconnected", async () => {
      const f = exchangeThenRevoke("apple-sub-1");
      const result = await revokeAppleSignInForUser("u1", fakeDb(), { config, fetch: f, authorizationCode: "fresh", appleUserId: "apple-sub-1" });
      expect(result).toBe("revoked");
      expect(f.mock.calls[0][0]).toBe("https://appleid.apple.com/auth/token");
      expect(form(f.mock.calls[0]).get("code")).toBe("fresh");
      expect(f.mock.calls[1][0]).toBe("https://appleid.apple.com/auth/revoke");
      expect(form(f.mock.calls[1]).get("token")).toBe("r-fresh");
    });

    it("prefers it to a stored token", async () => {
      const f = exchangeThenRevoke("apple-sub-1");
      await revokeAppleSignInForUser("u1", fakeDb([{ user_id: "u1", refresh_token: "r-old" }]), { config, fetch: f, authorizationCode: "fresh", appleUserId: "apple-sub-1" });
      expect(form(f.mock.calls[1]).get("token")).toBe("r-fresh");
    });

    it("does not revoke a grant that belongs to a different Apple account, and falls back to the stored token", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const f = vi
        .fn()
        .mockResolvedValueOnce(reply(200, { refresh_token: "r-other", id_token: jwt({ sub: "someone-else" }) }))
        .mockResolvedValueOnce(reply(200));
      const result = await revokeAppleSignInForUser("u1", fakeDb([{ user_id: "u1", refresh_token: "r-own" }]), {
        config, fetch: f, authorizationCode: "fresh", appleUserId: "apple-sub-1",
      });
      expect(result).toBe("revoked");
      expect(f).toHaveBeenCalledTimes(2);
      expect(form(f.mock.calls[1]).get("token")).toBe("r-own");
      vi.restoreAllMocks();
    });

    it("falls back to the stored token when the code is expired or used", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const f = vi.fn().mockResolvedValueOnce(reply(400, { error: "invalid_grant" })).mockResolvedValueOnce(reply(200));
      const result = await revokeAppleSignInForUser("u1", fakeDb([{ user_id: "u1", refresh_token: "r-own" }]), { config, fetch: f, authorizationCode: "stale" });
      expect(result).toBe("revoked");
      expect(form(f.mock.calls[1]).get("token")).toBe("r-own");
      vi.restoreAllMocks();
    });

    it("has nothing to revoke with a bad code and no stored token, and still never throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const f = vi.fn().mockResolvedValue(reply(400, { error: "invalid_grant" }));
      expect(await revokeAppleSignInForUser("u1", fakeDb(), { config, fetch: f, authorizationCode: "stale" })).toBe("no_token");
      vi.restoreAllMocks();
    });
  });

  it("never throws, so a failure at Apple cannot stop an account from being deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn().mockResolvedValue(reply(503));
    expect(await revokeAppleSignInForUser("u1", fakeDb([{ user_id: "u1", refresh_token: "r" }]), { config, fetch: down })).toBe("failed");
    expect(await revokeAppleSignInForUser("u1", fakeDb([], "db down"), { config, fetch: down })).toBe("failed");
    vi.restoreAllMocks();
  });
});
