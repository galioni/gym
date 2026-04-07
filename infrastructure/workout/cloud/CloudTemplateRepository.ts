import { TemplateRepository } from "../../../interfaces/workout/TemplateRepository";
import { Templates } from "../../../types";
import { sanitizeTemplates } from "../../../application/workout/templates/templateRules";
import { TemplateSnapshot } from "../../../application/sync/syncTypes";
import { AuthTokenProvider } from "../../../interfaces/auth/AuthTokenProvider";
import { toCloudApiError } from "./cloudApiError";

interface CloudTemplateEnvelope {
  version: number;
  updatedAt: string;
  templates: Templates;
}

/**
 * Cloud-backed template repository scaffold. Expects a JSON API endpoint.
 */
export class CloudTemplateRepository implements TemplateRepository {
  public constructor(
    private readonly apiBaseUrl: string,
    private readonly tokenProvider: AuthTokenProvider
  ) {}

  private async getAuthHeader(): Promise<Record<string, string>> {
    const accessToken = await this.tokenProvider.getAccessToken();
    if (!accessToken) {
      throw new Error("Missing authenticated session. Sign in again and retry sync.");
    }
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  public async readSnapshot(): Promise<TemplateSnapshot | null> {
    const response = await fetch(`${this.apiBaseUrl}/templates`, {
      method: "GET",
      headers: await this.getAuthHeader(),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await toCloudApiError(response, "Cloud template read");
    }

    const payload = (await response.json()) as CloudTemplateEnvelope | Partial<Templates>;
    const rawTemplates =
      payload && typeof payload === "object" && "templates" in payload
        ? (payload as CloudTemplateEnvelope).templates
        : (payload as Partial<Templates>);
    return {
      version:
        payload && typeof payload === "object" && "version" in payload
          ? Number((payload as CloudTemplateEnvelope).version) || 1
          : 1,
      updatedAt:
        payload && typeof payload === "object" && "updatedAt" in payload
          ? String((payload as CloudTemplateEnvelope).updatedAt)
          : new Date().toISOString(),
      data: sanitizeTemplates(rawTemplates),
    };
  }

  public async readTemplates(): Promise<Templates | null> {
    const snapshot = await this.readSnapshot();
    return snapshot?.data ?? null;
  }

  public async writeSnapshot(snapshot: TemplateSnapshot): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/templates`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await this.getAuthHeader()),
      },
      body: JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        templates: snapshot.data,
      }),
    });
    if (!response.ok) {
      throw await toCloudApiError(response, "Cloud template write");
    }
  }

  public async writeTemplates(templates: Templates): Promise<void> {
    await this.writeSnapshot({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: templates,
    });
  }
}