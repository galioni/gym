import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkoutDataRepository } from "./CloudWorkoutDataRepository";

class StubAuthTokenProvider {
  public async getAccessToken(): Promise<string> {
    return "access-token";
  }
}

describe("CloudWorkoutDataRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes API error details and request id when reads fail", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: {
        get(name: string) {
          return name.toLowerCase() === "x-request-id" ? "req-123" : null;
        },
      },
      text: async () => JSON.stringify({ error: "Internal server error" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const repository = new CloudWorkoutDataRepository(
      "https://gym.example.com/api",
      new StubAuthTokenProvider()
    );

    await expect(repository.readSnapshot()).rejects.toThrow(
      "Cloud workout read failed: 500 | Internal server error | requestId=req-123"
    );
  });
});