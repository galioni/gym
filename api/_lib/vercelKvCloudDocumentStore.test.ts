import { afterEach, describe, expect, it, vi } from "vitest";
import { VercelKvCloudDocumentStore } from "./vercelKvCloudDocumentStore";

describe("VercelKvCloudDocumentStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses JSON documents returned from KV reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: JSON.stringify({
          version: 1,
          updatedAt: "2026-04-07T09:00:00.000Z",
          data: { "2026-04-07": { warmup: [] } },
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new VercelKvCloudDocumentStore({
      kvRestApiUrl: "https://kv.example.com",
      kvRestApiToken: "token",
    });

    await expect(store.readDocument("sync:user:workout-data")).resolves.toEqual({
      version: 1,
      updatedAt: "2026-04-07T09:00:00.000Z",
      data: { "2026-04-07": { warmup: [] } },
    });
  });

  it("preserves plain string values when KV does not return JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: "plain-text",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new VercelKvCloudDocumentStore({
      kvRestApiUrl: "https://kv.example.com",
      kvRestApiToken: "token",
    });

    await expect(store.readDocument("sync:user:note")).resolves.toBe("plain-text");
  });
});