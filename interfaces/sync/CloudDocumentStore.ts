/**
 * Storage boundary for cloud sync documents keyed by resource name.
 */
export interface CloudDocumentStore {
  readDocument(key: string): Promise<unknown | null>;
  writeDocument(key: string, value: unknown): Promise<void>;
}
