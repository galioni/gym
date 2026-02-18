import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { TemplateService } from "../../../application/workout/TemplateService";
import { SyncService } from "../../../application/sync/SyncService";
import { CloudTemplateRepository } from "../cloud/CloudTemplateRepository";
import { CloudWorkoutDataRepository } from "../cloud/CloudWorkoutDataRepository";
import { LocalStorageTemplateRepository } from "../LocalStorageTemplateRepository";
import { LocalStorageWorkoutDataRepository } from "../LocalStorageWorkoutDataRepository";
import { LocalStorageSyncSettingsRepository } from "../../sync/LocalStorageSyncSettingsRepository";

interface WorkoutServices {
  workoutDataService: WorkoutDataService;
  templateService: TemplateService;
  syncService: SyncService;
}

/**
 * Local-first service factory with optional cloud mode.
 * If cloud mode is enabled, required env vars must be present.
 */
export function createWorkoutServices(): WorkoutServices {
  const localWorkoutRepository = new LocalStorageWorkoutDataRepository();
  const localTemplateRepository = new LocalStorageTemplateRepository();
  const syncSettingsRepository = new LocalStorageSyncSettingsRepository();

  const baseUrl = import.meta.env.VITE_SYNC_API_BASE_URL;
  const apiKey = import.meta.env.VITE_SYNC_API_KEY;
  const cloudWorkoutRepository =
    baseUrl && apiKey ? new CloudWorkoutDataRepository(baseUrl, apiKey) : null;
  const cloudTemplateRepository =
    baseUrl && apiKey ? new CloudTemplateRepository(baseUrl, apiKey) : null;

  return {
    workoutDataService: new WorkoutDataService(localWorkoutRepository),
    templateService: new TemplateService(localTemplateRepository),
    syncService: new SyncService({
      settingsRepository: syncSettingsRepository,
      localWorkoutRepository,
      localTemplateRepository,
      cloudWorkoutRepository,
      cloudTemplateRepository,
    }),
  };
}
