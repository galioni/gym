import { TEMPLATE_SCHEMA_VERSION, TEMPLATE_STORAGE_KEY } from "../../constants";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { Templates } from "../../types";
import { sanitizeTemplates } from "../../application/workout/templates/templateRules";
import { TemplateSnapshot } from "../../application/sync/syncTypes";

interface TemplateStorageEnvelope {
  version: number;
  updatedAt: string;
  templates: Templates;
}

/**
 * Local storage adapter for user-editable workout templates.
 */
export class LocalStorageTemplateRepository implements TemplateRepository {
  public async readSnapshot(): Promise<TemplateSnapshot | null> {
    const rawStorage = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!rawStorage) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawStorage) as TemplateStorageEnvelope | Partial<Templates>;

      const isEnvelope = Boolean(
        parsed &&
          typeof parsed === "object" &&
          "version" in parsed &&
          "templates" in parsed
      );

      const sanitized = isEnvelope
        ? sanitizeTemplates((parsed as TemplateStorageEnvelope).templates)
        : sanitizeTemplates(parsed as Partial<Templates>);

      const snapshot: TemplateSnapshot = {
        version: TEMPLATE_SCHEMA_VERSION,
        updatedAt:
          isEnvelope && typeof (parsed as TemplateStorageEnvelope).updatedAt === "string"
            ? (parsed as TemplateStorageEnvelope).updatedAt
            : new Date().toISOString(),
        data: sanitized,
      };

      await this.writeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.error("Failed to parse template storage, resetting to defaults.", error);
      localStorage.removeItem(TEMPLATE_STORAGE_KEY);
      return null;
    }
  }

  public async writeSnapshot(snapshot: TemplateSnapshot): Promise<void> {
    const envelope: TemplateStorageEnvelope = {
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      templates: sanitizeTemplates(snapshot.data),
    };
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(envelope));
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
