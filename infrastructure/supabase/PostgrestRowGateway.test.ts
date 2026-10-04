import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudLimitError } from "../../application/sync/syncErrors";
import { PostgrestRowGateway } from "./PostgrestRowGateway";

const tokenProvider = { getAccessToken: async () => "token" };
const identity = { getUserId: async () => "user-1" };

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("PostgrestRowGateway write errors", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("VITE_SUPABASE_REDIRECT_URL", "http://localhost:5180");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("turns the database's row-limit error into a CloudLimitError with a plain-language message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respond(422, {
        code: "PT422",
        message: "row limit reached for workout_days: at most 5000 per account",
        hint: "Delete older entries to free space.",
        details: null,
      })
    ));
    const gateway = new PostgrestRowGateway(tokenProvider, identity);

    const failure = await gateway.upsertRows("workout_days", [{ user_id: "user-1", day: "2026-10-01" }]).catch((e) => e);

    expect(failure).toBeInstanceOf(CloudLimitError);
    expect((failure as CloudLimitError).table).toBe("workout_days");
    expect((failure as Error).message).toContain("workout days");
    expect((failure as Error).message).toContain("safe on this device");
  });

  it("explains a refused old day (PT424) as a probable wrong device date, in the same words as the mobile app", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respond(424, { code: "PT424", message: "The Free plan keeps the last 7 days in the cloud", details: "2026-09-25", hint: "Older days stay on your device." })
    ));
    const gateway = new PostgrestRowGateway(tokenProvider, identity);

    const failure = await gateway.upsertRows("workout_days", [{ user_id: "user-1", day: "2026-09-01" }]).catch((e) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CloudLimitError);
    expect((failure as Error).message).toBe(
      "The cloud refused a day older than the last 7 days that the Free plan keeps. This usually means this device's date or time is wrong, so please check it. Your data is safe on this device."
    );
  });

  it("keeps ordinary write failures as ordinary errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(500, { code: "XX000", message: "boom" })));
    const gateway = new PostgrestRowGateway(tokenProvider, identity);

    const failure = await gateway.upsertRows("templates", [{ user_id: "user-1", session_type: "push" }]).catch((e) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CloudLimitError);
    expect((failure as Error).message).toContain("boom");
  });

  it("sends the user's access token and the anon key on every request", async () => {
    const fetchMock = vi.fn(async () => respond(200, []));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new PostgrestRowGateway(tokenProvider, identity);

    await gateway.selectAll("plans");

    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("apikey")).toBe("anon");
  });
});
