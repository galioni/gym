import { TEMPLATES } from "../../constants";
import { TemplateRepository } from "../../interfaces/workout/TemplateRepository";
import { SessionType, TemplateData, Templates } from "../../types";
import { sanitizeTemplates } from "./templates/templateRules";
import {
  createSessionType,
  CreateSessionTypeResult,
  getDefaultTemplate,
} from "./sessionTypes/sessionTypeRules";

/**
 * Application-layer service for reading and persisting workout templates.
 */
export class TemplateService {
  public constructor(private readonly repository: TemplateRepository) {}

  public async loadTemplates(): Promise<Templates> {
    return sanitizeTemplates((await this.repository.readTemplates()) ?? TEMPLATES);
  }

  public async saveTemplates(templates: Templates): Promise<void> {
    await this.repository.writeTemplates(sanitizeTemplates(templates));
  }

  public getDefaultSection(
    session: SessionType,
    section: keyof TemplateData
  ): TemplateData[keyof TemplateData] {
    return getDefaultTemplate(session)[section].map((row) => ({ ...row }));
  }

  public createSessionType(templates: Templates, label: string): CreateSessionTypeResult {
    return createSessionType(templates, label);
  }
}