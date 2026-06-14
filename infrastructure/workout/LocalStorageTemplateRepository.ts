import { TEMPLATE_SCHEMA_VERSION, TEMPLATE_STORAGE_KEY } from "../../constants";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { Templates } from "../../types";
import { sanitizeTemplates } from "../../application/workout/templates/templateRules";
import { TemplateSnapshot } from "../../application/sync/syncTypes";
import { migrateRawTemplateSnapshot } from "../../application/sync/migrations/snapshotMigrations";

export class LocalStorageTemplateRepository implements TemplateRepository {
  public async readSnapshot(): Promise<TemplateSnapshot | null> {
    const rawStorage = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!rawStorage) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawStorage) as unknown;
      const snapshot: TemplateSnapshot = migrateRawTemplateSnapshot(parsed);
      await this.writeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.error("Failed to parse template storage, resetting to defaults.", error);
      localStorage.removeItem(TEMPLATE_STORAGE_KEY);
      return null;
    }
  }

  public async writeSnapshot(snapshot: TemplateSnapshot): Promise<void> {
    if (snapshot.version > TEMPLATE_SCHEMA_VERSION) {
      throw new Error(
        `Cannot write templates schema version ${snapshot.version}: app supports up to v${TEMPLATE_SCHEMA_VERSION}.`
      );
    }
    localStorage.setItem(
      TEMPLATE_STORAGE_KEY,
      JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        templates: sanitizeTemplates(snapshot.data),
      })
    );
  }

  public async readTemplates(): Promise<Templates | null> {
    const snapshot = await this.readSnapshot();
    if (!snapshot) {
      return null;
    }
    return snapshot.data;
  }

  public async writeTemplates(templates: Templates): Promise<void> {
    await this.writeSnapshot({
      version: TEMPLATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      data: sanitizeTemplates(templates),
    });
  }
}
