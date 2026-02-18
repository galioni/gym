import { WorkoutDataRepository } from "../../../interfaces/workout/WorkoutDataRepository";
import { DayData } from "../../../types";
import { sanitizeDayDataRecord } from "../../../application/workout/data/dayDataRules";
import { TEMPLATES } from "../../../constants";
import { WorkoutDataSnapshot } from "../../../application/sync/syncTypes";

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
    private readonly apiKey: string
  ) {}

  public async readSnapshot(): Promise<WorkoutDataSnapshot | null> {
    const response = await fetch(`${this.apiBaseUrl}/workout-data`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Cloud workout read failed: ${response.status}`);
    }

    const payload = (await response.json()) as CloudRecordEnvelope | Record<string, unknown>;
    const rawData =
      payload && typeof payload === "object" && "data" in payload
        ? (payload as CloudRecordEnvelope).data
        : (payload as Record<string, unknown>);
    const sanitized = sanitizeDayDataRecord(rawData, TEMPLATES);
    return {
      version: payload && typeof payload === "object" && "version" in payload
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
    const response = await fetch(`${this.apiBaseUrl}/workout-data`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        data: snapshot.data,
      }),
    });
    if (!response.ok) {
      throw new Error(`Cloud workout write failed: ${response.status}`);
    }
  }

  public async writeAll(data: Record<string, DayData>): Promise<void> {
    await this.writeSnapshot({
      version: 1,
      updatedAt: new Date().toISOString(),
      data,
    });
  }
}
