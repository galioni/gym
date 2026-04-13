import { WorkoutDataRepository } from "../../../interfaces/workout/WorkoutDataRepository";
import { DayData } from "../../../types";
import { sanitizeDayDataRecord } from "../../../application/workout/data/dayDataRules";
import { TEMPLATES } from "../../../constants";
import { WorkoutDataSnapshot } from "../../../application/sync/syncTypes";
import { AuthTokenProvider } from "../../../interfaces/auth/AuthTokenProvider";
import { fetchWithTimeout, toCloudApiError, CloudApiPaymentRequiredError } from "./cloudApiError";

interface CloudRecordEnvelope {
  version: number;
  updatedAt: string;
  data: Record<string, DayData>;
}

/**
 * Cloud-backed workout repository scaffold. Expects a JSON API endpoint.
 */
export class CloudWorkoutDataRepository implements WorkoutDataRepository {
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

  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    const response = await fetchWithTimeout(`${this.apiBaseUrl}/workout-data`, {
      method: "GET",
      headers: await this.getAuthHeader(),
    });
    if (response.status === 404) return null;
    if (response.status === 402) throw new CloudApiPaymentRequiredError();
    if (!response.ok) throw await toCloudApiError(response, "Cloud workout read");

    const payload = (await response.json()) as CloudRecordEnvelope | Record<string, unknown>;
    const rawData =
      payload && typeof payload === "object" && "data" in payload
        ? (payload as CloudRecordEnvelope).data
        : (payload as Record<string, unknown>);
    const sanitized = sanitizeDayDataRecord(rawData, TEMPLATES);
    return {
      version:
        payload && typeof payload === "object" && "version" in payload
          ? Number((payload as CloudRecordEnvelope).version) || 1
          : 1,
      updatedAt:
        payload && typeof payload === "object" && "updatedAt" in payload
          ? String((payload as CloudRecordEnvelope).updatedAt)
          : new Date().toISOString(),
      data: sanitized,
    };
  }

  public async readAll(): Promise<Record<string, DayData>> {
    const snapshot = await this.readSnapshot();
    return snapshot?.data ?? {};
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void> {
    const response = await fetchWithTimeout(`${this.apiBaseUrl}/workout-data`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(await this.getAuthHeader()),
      },
      body: JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        data: snapshot.data,
      }),
    });
    if (response.status === 402) throw new CloudApiPaymentRequiredError();
    if (!response.ok) throw await toCloudApiError(response, "Cloud workout write");
  }

  public async writeAll(data: Record<string, DayData>): Promise<void> {
    await this.writeSnapshot({
      version: 1,
      updatedAt: new Date().toISOString(),
      data,
    });
  }
}