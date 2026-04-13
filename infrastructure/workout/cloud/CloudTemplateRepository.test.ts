import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudTemplateRepository } from "./CloudTemplateRepository";
import { TEMPLATES } from "../../../constants";

class StubTokenProvider {
  public async getAccessToken(): Promise<string> {
    return "access-token";
  }
}

const BASE_URL = "https://gym.example.com/api";

function makeFetch(options: {
  status: number;
  body?: unknown;
  requestId?: string;
}) {
  const ok = options.status >= 200 && options.status < 300;
  return vi.fn().mockResolvedValue({
    ok,
    status: options.status,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "x-request-id" ? (options.requestId ?? null) : null;
      },
    },
    json: async () => options.body,
    text: async () => (options.body !== undefined ? JSON.stringify(options.body) : ""),
  });
}

describe("CloudTemplateRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("readSnapshot returns null on 404", async () => {
    vi.stubGlobal("fetch", makeFetch({ status: 404 }));
    const repo = new CloudTemplateRepository(BASE_URL, new StubTokenProvider());

    const result = await repo.readSnapshot();

    expect(result).toBeNull();
  });

  it("readSnapshot parses envelope format with version and updatedAt", async () => {
    const body = {
      version: 3,
      updatedAt: "2026-01-15T10:00:00.000Z",
      templates: { gym: { warmup: [{ text: "Bike", target: "5 min" }], main: [] } },
    };
    vi.stubGlobal("fetch", makeFetch({ status: 200, body }));
    const repo = new CloudTemplateRepository(BASE_URL, new StubTokenProvider());

    const result = await repo.readSnapshot();

    expect(result?.version).toBe(3);
    expect(result?.updatedAt).toBe("2026-01-15T10:00:00.000Z");
    expect(result?.data.gym.warmup[0].text).toBe("Bike");
  });

  it("readSnapshot handles legacy format without envelope", async () => {
    const body = { gym: { warmup: [{ text: "Bike", target: "5 min" }], main: [] } };
    vi.stubGlobal("fetch", makeFetch({ status: 200, body }));
    const repo = new CloudTemplateRepository(BASE_URL, new StubTokenProvider());

    const result = await repo.readSnapshot();

    expect(result?.version).toBe(1);
    expect(result?.data.gym.warmup[0].text).toBe("Bike");
  });

  it("readSnapshot includes error detail and request id on server error", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        status: 500,
        body: { error: "Internal server error" },
        requestId: "req-abc",
      })
    );
    const repo = new CloudTemplateRepository(BASE_URL, new StubTokenProvider());

    await expect(repo.readSnapshot()).rejects.toThrow(
      "Cloud template read failed: 500 | Internal server error | requestId=req-abc"
    );
  });

  it("writeSnapshot sends PUT with version, updatedAt, and templates", async () => {
    const fetchMock = makeFetch({ status: 200, body: { ok: true } });
    vi.stubGlobal("fetch", fetchMock);
    const repo = new CloudTemplateRepository(BASE_URL, new StubTokenProvider());

    await repo.writeSnapshot({
      version: 2,
      updatedAt: "2026-03-01T00:00:00.000Z",
      data: TEMPLATES,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/templates`);
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.version).toBe(2);
    expect(body.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(body.templates).toEqual(TEMPLATES);
  });

  it("writeSnapshot throws with error detail on failure", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        status: 500,
        body: { error: "Internal server error", requestId: "req-xyz" },
      })
    );
    const repo = new CloudTemplateRepository(BASE_URL, new StubTokenProvider());

    await expect(
      repo.writeSnapshot({ version: 1, updatedAt: new Date().toISOString(), data: TEMPLATES })
    ).rejects.toThrow("Cloud template write failed: 500 | Internal server error");
  });
});
