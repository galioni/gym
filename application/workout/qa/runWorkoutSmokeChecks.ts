import { WorkoutDataService } from "../WorkoutDataService";
import { WorkoutDataRepository } from "../../../interfaces/workout/WorkoutDataRepository";
import { DayData } from "../../../types";
import { createEmptyDay } from "../../../utils";
import {
  clearDayKeepingSession,
  resetSectionsFromTemplate,
  toggleItemInSection,
} from "../transitions/WorkoutStateTransitions";
import { WorkoutDataSnapshot } from "../../sync/syncTypes";

export interface SmokeCaseResult {
  name: string;
  pass: boolean;
  detail: string;
}

class InMemoryWorkoutRepository implements WorkoutDataRepository {
  private store: Record<string, DayData> = {};

  public async readAll() {
    return this.store;
  }

  public async writeAll(data: Record<string, DayData>) {
    this.store = data;
  }

  public async readSnapshot(): Promise<WorkoutDataSnapshot> {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: this.store,
    };
  }

  public async writeSnapshot(snapshot: WorkoutDataSnapshot): Promise<void> {
    this.store = snapshot.data;
  }
}

/**
 * Shared smoke-check suite used by the QA panel to avoid duplicating transition assertions.
 */
export async function runWorkoutSmokeChecks(date = "2026-02-17"): Promise<SmokeCaseResult[]> {
  const results: SmokeCaseResult[] = [];
  const baseDay = createEmptyDay(date, "tennis");

  const toggledDay = toggleItemInSection(baseDay, "warmup", baseDay.warmup[0]?.id ?? "", true);
  results.push({
    name: "Toggle item state",
    pass: toggledDay.warmup[0]?.done === true,
    detail: toggledDay.warmup[0]?.done ? "First warmup item marked complete." : "Warmup toggle failed.",
  });

  const resetDay = resetSectionsFromTemplate(date, "gym", {
    ...baseDay,
    sessionType: "gym",
    warmupNotes: "Keep me",
    mainNotes: "Keep me too",
  });
  results.push({
    name: "Template reset preserves notes",
    pass: resetDay.warmupNotes === "Keep me" && resetDay.mainNotes === "Keep me too",
    detail: "Notes remain while workout lists/timers reset.",
  });

  const clearedDay = clearDayKeepingSession(date, "swim");
  results.push({
    name: "Clear day keeps selected session",
    pass: clearedDay.sessionType === "swim",
    detail: `Session type after clear: ${clearedDay.sessionType}`,
  });

  const repository = new InMemoryWorkoutRepository();
  const service = new WorkoutDataService(repository);
  const payload = { [date]: baseDay };
  await service.saveAllData(payload);
  const loaded = await service.loadAllData();
  const pass = loaded[date]?.date === date;
  results.push({
    name: "Service persistence roundtrip",
    pass,
    detail: pass ? "In-memory repository returned saved date payload." : "Repository roundtrip failed.",
  });

  return results;
}
