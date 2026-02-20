import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { TemplateService } from "../../../application/workout/TemplateService";
import { SyncService } from "../../../application/sync/SyncService";
import { CloudTemplateRepository } from "../cloud/CloudTemplateRepository";
import { CloudWorkoutDataRepository } from "../cloud/CloudWorkoutDataRepository";
import { LocalStorageTemplateRepository } from "../LocalStorageTemplateRepository";
import { LocalStorageWorkoutDataRepository } from "../LocalStorageWorkoutDataRepository";
import { LocalStorageSyncSettingsRepository } from "../../sync/LocalStorageSyncSettingsRepository";
import { SupabaseTokenProvider } from "../../auth/supabase/SupabaseTokenProvider";

interface WorkoutServices {
  workoutDataService: WorkoutDataService;
  templateService: TemplateService;
  syncService: SyncService;
}

/**
 * Local-first service factory with optional cloud mode.
 * Cloud adapters are wired only when `VITE_SYNC_API_BASE_URL` is configured.
 */
export function createWorkoutServices(): WorkoutServices {
  const localWorkoutRepository = new LocalStorageWorkoutDataRepository();
  const localTemplateRepository = new LocalStorageTemplateRepository();
  const syncSettingsRepository = new LocalStorageSyncSettingsRepository();

  const baseUrl = import.meta.env.VITE_SYNC_API_BASE_URL;
  const tokenProvider = new SupabaseTokenProvider();
  const cloudWorkoutRepository = baseUrl
    ? new CloudWorkoutDataRepository(baseUrl, tokenProvider)
    : null;
  const cloudTemplateRepository = baseUrl
    ? new CloudTemplateRepository(baseUrl, tokenProvider)
    : null;

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
