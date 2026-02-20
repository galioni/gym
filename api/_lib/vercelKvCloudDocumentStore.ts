import type { CloudDocumentStore } from "./cloudSyncApiService.js";

interface VercelKvEnv {
  kvRestApiUrl: string;
  kvRestApiToken: string;
}

/**
 * Upstash REST adapter used by Vercel serverless handlers.
 */
export class VercelKvCloudDocumentStore implements CloudDocumentStore {
  public constructor(private readonly env: VercelKvEnv) {}

  public async readDocument(key: string): Promise<unknown | null> {
    const response = await this.execute(["GET", key]);
    return response.result ?? null;
  }

  public async writeDocument(key: string, value: unknown): Promise<void> {
    await this.execute(["SET", key, JSON.stringify(value)]);
  }

  private async execute(command: [string, ...Array<string>]): Promise<{ result: unknown }> {
    const response = await fetch(this.env.kvRestApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.kvRestApiToken}`,
      },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      throw new Error(`Vercel KV request failed: ${response.status}`);
    }
    return (await response.json()) as { result: unknown };
  }
}
