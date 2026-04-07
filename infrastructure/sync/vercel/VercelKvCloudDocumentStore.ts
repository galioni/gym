import { CloudDocumentStore } from "../../../interfaces/sync/CloudDocumentStore";

interface VercelKvEnv {
  kvRestApiUrl: string;
  kvRestApiToken: string;
}

/**
 * Vercel KV adapter using Upstash REST commands.
 */
export class VercelKvCloudDocumentStore implements CloudDocumentStore {
  public constructor(private readonly env: VercelKvEnv) {}

  public async readDocument(key: string): Promise<unknown | null> {
    const response = await this.execute(["GET", key]);
    return this.normalizeResult(response.result);
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

  private normalizeResult(result: unknown): unknown | null {
    if (result === null || typeof result === "undefined") {
      return null;
    }
    if (typeof result !== "string") {
      return result;
    }

    try {
      // The cloud sync API stores whole documents as JSON strings in KV, so reads
      // need to reverse that encoding before repository consumers inspect fields.
      return JSON.parse(result) as unknown;
    } catch {
      return result;
    }
  }
}