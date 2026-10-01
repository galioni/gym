import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { TemplateService } from "../../../application/workout/TemplateService";
import { SyncService } from "../../../application/sync/SyncService";
import { PlanService } from "../../../application/workout/PlanService";
import { LocalStorageTemplateRepository } from "../LocalStorageTemplateRepository";
import { LocalStorageWorkoutDataRepository } from "../LocalStorageWorkoutDataRepository";
import { LocalStorageSyncSettingsRepository } from "../../sync/LocalStorageSyncSettingsRepository";
import { LocalStoragePlansRepository } from "../LocalStoragePlansRepository";
import { SupabaseTokenProvider } from "../../auth/supabase/SupabaseTokenProvider";
import { PostgrestRowGateway, createUserPostgrestClient } from "../../supabase/PostgrestRowGateway";
import { PostgrestSyncAllowance } from "../../supabase/PostgrestSyncAllowance";
import { SyncAllowance } from "../../../application/sync/syncAllowance";
import { LocalStorageAccountSettingsRepository } from "../LocalStorageAccountSettingsRepository";
import {
  PostgresAccountSettingsRepository,
  PostgresPlansRepository,
  PostgresTemplateRepository,
  PostgresWorkoutDataRepository,
} from "../../supabase/PostgresRepositories";

interface WorkoutServices {
  workoutDataService: WorkoutDataService;
  templateService: TemplateService;
  syncService: SyncService;
  planService: PlanService;
  /** The Free plan's monthly sync: asked before every sync, and read by the screen. */
  syncAllowance: SyncAllowance;
}

/**
 * Local-first service factory. The browser keeps a localStorage copy for instant, offline use; Postgres
 * (queried directly with the signed-in user's token under row level security) is the source of truth,
 * and SyncService reconciles the two.
 */
export function createWorkoutServices(): WorkoutServices {
  const localWorkoutRepository = new LocalStorageWorkoutDataRepository();
  const localTemplateRepository = new LocalStorageTemplateRepository();
  const syncSettingsRepository = new LocalStorageSyncSettingsRepository();
  const plansRepository = new LocalStoragePlansRepository();

  const tokenProvider = new SupabaseTokenProvider();
  const gateway = new PostgrestRowGateway(tokenProvider, tokenProvider);
  const syncAllowance = new PostgrestSyncAllowance(createUserPostgrestClient(tokenProvider));

  return {
    workoutDataService: new WorkoutDataService(localWorkoutRepository),
    templateService: new TemplateService(localTemplateRepository),
    planService: new PlanService(plansRepository),
    syncAllowance,
    syncService: new SyncService({
      settingsRepository: syncSettingsRepository,
      allowance: syncAllowance,
      localWorkoutRepository,
      localTemplateRepository,
      cloudWorkoutRepository: new PostgresWorkoutDataRepository(gateway),
      cloudTemplateRepository: new PostgresTemplateRepository(gateway),
      localPlansRepository: plansRepository,
      cloudPlansRepository: new PostgresPlansRepository(gateway),
      localSettingsRepository: new LocalStorageAccountSettingsRepository(),
      cloudSettingsRepository: new PostgresAccountSettingsRepository(gateway),
    }),
  };
}
