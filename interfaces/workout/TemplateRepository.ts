import { Templates } from "../../types";
import { TemplateSnapshot } from "../../application/sync/syncTypes";

/**
 * Storage boundary for session templates.
 */
export interface TemplateRepository {
  readTemplates(): Promise<Templates | null>;
  writeTemplates(templates: Templates): Promise<void>;
  readSnapshot(): Promise<TemplateSnapshot | null>;
  writeSnapshot(snapshot: TemplateSnapshot): Promise<void>;
}
