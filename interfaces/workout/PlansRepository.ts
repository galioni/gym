import { Plan } from "../../types";
import { PlansSnapshot } from "../../application/sync/syncTypes";

export interface PlansRepository {
  readPlans(): Promise<Plan[]>;
  writePlans(plans: Plan[]): Promise<void>;
  readActivePlanId(): Promise<string | null>;
  writeActivePlanId(id: string | null): Promise<void>;
  readSnapshot(): Promise<PlansSnapshot | null>;
  writeSnapshot(snapshot: PlansSnapshot): Promise<void>;
}
