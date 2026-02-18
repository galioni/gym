import { CloudDocumentStore } from "../../interfaces/sync/CloudDocumentStore";

/**
 * Application service for cloud sync resource reads/writes.
 * Resource payload validation stays at the API boundary.
 */
export class CloudSyncApiService {
  public constructor(private readonly store: CloudDocumentStore) {}

  public async getResource<T>(resourceKey: string): Promise<T | null> {
    const value = await this.store.readDocument(resourceKey);
    return (value as T | null) ?? null;
  }

  public async putResource(resourceKey: string, payload: unknown): Promise<void> {
    await this.store.writeDocument(resourceKey, payload);
  }
}
