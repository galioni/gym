import { DayData } from "../../types";
import { WorkoutDataRepository } from "../../interfaces/workout/WorkoutDataRepository";

/**
 * Application-layer service that orchestrates workout snapshot persistence.
 */
export class WorkoutDataService {
  public constructor(private readonly repository: WorkoutDataRepository) {}

  public async loadAllData(): Promise<Record<string, DayData>> {
    return this.repository.readAll();
  }

  public async saveAllData(data: Record<string, DayData>): Promise<void> {
    await this.repository.writeAll(data);
  }
}

