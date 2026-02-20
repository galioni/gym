export interface CloudDocumentStore {
  readDocument(key: string): Promise<unknown | null>;
  writeDocument(key: string, value: unknown): Promise<void>;
}

/**
 * API-local service for cloud sync resource reads/writes.
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
