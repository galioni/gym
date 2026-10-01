import { ACTIVE_PLAN_STORAGE_KEY, PLAN_META_STORAGE_KEY, PLAN_PARAMS_STORAGE_KEY } from "../../constants";
import { GeneratedPlanMeta, PlanParams } from "../../types";
import { SettingsSnapshot, SyncedSettings } from "../../application/sync/syncTypes";
import { AccountSettingsRepository } from "../../interfaces/workout/AccountSettingsRepository";

function readObject<T>(key: string): T | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function writeOrRemove(key: string, value: string | null): void {
  if (value === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
}

/**
 * The account preferences that live in separate localStorage keys (active plan, plan params, plan meta),
 * presented as one snapshot so they can be synced. They have no timestamp of their own: updatedAt is "now".
 */
export class LocalStorageAccountSettingsRepository implements AccountSettingsRepository {
  public async readSnapshot(): Promise<SettingsSnapshot> {
    const activePlanId = localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: {
        activePlanId: activePlanId && activePlanId.length > 0 ? activePlanId : null,
        planParams: readObject<PlanParams>(PLAN_PARAMS_STORAGE_KEY),
        planMeta: readObject<GeneratedPlanMeta>(PLAN_META_STORAGE_KEY),
      },
    };
  }

  public async writeSnapshot(snapshot: SettingsSnapshot): Promise<void> {
    const { activePlanId, planParams, planMeta }: SyncedSettings = snapshot.data;
    writeOrRemove(ACTIVE_PLAN_STORAGE_KEY, activePlanId);
    writeOrRemove(PLAN_PARAMS_STORAGE_KEY, planParams ? JSON.stringify(planParams) : null);
    writeOrRemove(PLAN_META_STORAGE_KEY, planMeta ? JSON.stringify(planMeta) : null);
  }
}
