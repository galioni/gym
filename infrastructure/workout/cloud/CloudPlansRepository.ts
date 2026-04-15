import { Plan } from "../../../types";
import { PlansRepository } from "../../../interfaces/workout/PlansRepository";
import { PlansSnapshot } from "../../../application/sync/syncTypes";
import { AuthTokenProvider } from "../../../interfaces/auth/AuthTokenProvider";
import { fetchWithTimeout, toCloudApiError, CloudApiPaymentRequiredError } from "./cloudApiError";

interface CloudPlansEnvelope {
  version: number;
  updatedAt: string;
  plans: Plan[];
}

export class CloudPlansRepository implements PlansRepository {
  public constructor(
    private readonly apiBaseUrl: string,
    private readonly tokenProvider: AuthTokenProvider
  ) {}

  private async getAuthHeader(): Promise<Record<string, string>> {
    const accessToken = await this.tokenProvider.getAccessToken();
    if (!accessToken) {
      throw new Error("Missing authenticated session. Sign in again and retry sync.");
    }
    return { Authorization: `Bearer ${accessToken}` };
  }

  public async readSnapshot(): Promise<PlansSnapshot | null> {
    const response = await fetchWithTimeout(`${this.apiBaseUrl}/plans`, {
      method: "GET",
      headers: await this.getAuthHeader(),
    });
    if (response.status === 404) return null;
    if (response.status === 402) throw new CloudApiPaymentRequiredError();
    if (!response.ok) throw await toCloudApiError(response, "Cloud plans read");

    const payload = (await response.json()) as CloudPlansEnvelope;
    const rawPlans = Array.isArray(payload.plans) ? payload.plans : [];
    // Filter out any malformed entries so the client never processes null/invalid plan objects
    const validPlans = rawPlans.filter(
      (p): p is Plan =>
        p !== null &&
        typeof p === "object" &&
        typeof p.id === "string" &&
        p.id.length > 0 &&
        typeof p.label === "string" &&
        Array.isArray(p.sessionIds)
    );
    return {
      version: typeof payload.version === "number" ? payload.version : 1,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : new Date().toISOString(),
      data: validPlans,
    };
  }

  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> {
    const response = await fetchWithTimeout(`${this.apiBaseUrl}/plans`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await this.getAuthHeader()),
      },
      body: JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        plans: snapshot.data,
      }),
    });
    if (response.status === 402) throw new CloudApiPaymentRequiredError();
    if (!response.ok) throw await toCloudApiError(response, "Cloud plans write");
  }

  // These are not used by CloudPlansRepository — sync is snapshot-only for cloud.
  public async readPlans(): Promise<Plan[]> {
    const snapshot = await this.readSnapshot();
    return snapshot?.data ?? [];
  }

  public async writePlans(plans: Plan[]): Promise<void> {
    await this.writeSnapshot({ version: 1, updatedAt: new Date().toISOString(), data: plans });
  }

  public async readActivePlanId(): Promise<string | null> {
    return null;
  }

  public async writeActivePlanId(): Promise<void> {
    // Active plan ID is a device-local preference — not synced.
  }
}
