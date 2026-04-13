import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { TemplateService } from "../../../application/workout/TemplateService";
import { SyncService } from "../../../application/sync/SyncService";
import { PlanService } from "../../../application/workout/PlanService";
import { CloudTemplateRepository } from "../cloud/CloudTemplateRepository";
import { CloudWorkoutDataRepository } from "../cloud/CloudWorkoutDataRepository";
import { CloudPlansRepository } from "../cloud/CloudPlansRepository";
import { LocalStorageTemplateRepository } from "../LocalStorageTemplateRepository";
import { LocalStorageWorkoutDataRepository } from "../LocalStorageWorkoutDataRepository";
import { LocalStorageSyncSettingsRepository } from "../../sync/LocalStorageSyncSettingsRepository";
import { LocalStoragePlansRepository } from "../LocalStoragePlansRepository";
import { SupabaseTokenProvider } from "../../auth/supabase/SupabaseTokenProvider";

interface WorkoutServices {
  workoutDataService: WorkoutDataService;
  templateService: TemplateService;
  syncService: SyncService;
  planService: PlanService;
}

function toSyncApiBaseUrl(rawValue: string | undefined): string | null {
  if (!rawValue || rawValue.trim().length === 0) {
    return null;
  }
  const normalized = rawValue.trim().replace(/\/+$/, "");
  // Vercel serverless functions are mounted under /api by default.
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
}

function getRequiredSyncApiBaseUrl(): string {
  const normalizedBaseUrl = toSyncApiBaseUrl(import.meta.env.VITE_SYNC_API_BASE_URL);
  if (!normalizedBaseUrl) {
    throw new Error("Missing required env var: VITE_SYNC_API_BASE_URL");
  }
  return normalizedBaseUrl;
}

/**
 * Local-first service factory with mandatory cloud sync support.
 */
export function createWorkoutServices(): WorkoutServices {
  const localWorkoutRepository = new LocalStorageWorkoutDataRepository();
  const localTemplateRepository = new LocalStorageTemplateRepository();
  const syncSettingsRepository = new LocalStorageSyncSettingsRepository();
  const plansRepository = new LocalStoragePlansRepository();

  const baseUrl = getRequiredSyncApiBaseUrl();
  const tokenProvider = new SupabaseTokenProvider();
  const cloudWorkoutRepository = new CloudWorkoutDataRepository(baseUrl, tokenProvider);
  const cloudTemplateRepository = new CloudTemplateRepository(baseUrl, tokenProvider);
  const cloudPlansRepository = new CloudPlansRepository(baseUrl, tokenProvider);

  return {
    workoutDataService: new WorkoutDataService(localWorkoutRepository),
    templateService: new TemplateService(localTemplateRepository),
    planService: new PlanService(plansRepository),
    syncService: new SyncService({
      settingsRepository: syncSettingsRepository,
      localWorkoutRepository,
      localTemplateRepository,
      cloudWorkoutRepository,
      cloudTemplateRepository,
      localPlansRepository: plansRepository,
      cloudPlansRepository,
    }),
  };
}
