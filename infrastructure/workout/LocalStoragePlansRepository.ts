import { Plan } from "../../types";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { PlansSnapshot } from "../../application/sync/syncTypes";
import { PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY } from "../../constants";

const PLANS_SCHEMA_VERSION = 1;

interface PlansStorageEnvelope {
  version: number;
  updatedAt: string;
  plans: Plan[];
}

function isValidPlan(value: unknown): value is Plan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    Array.isArray(p.sessionIds) &&
    p.sessionIds.every((s) => typeof s === "string")
  );
}

export class LocalStoragePlansRepository implements PlansRepository {
  public async readSnapshot(): Promise<PlansSnapshot | null> {
    const raw = localStorage.getItem(PLANS_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // Support both envelope format and legacy plain array
      if (Array.isArray(parsed)) {
        const plans = parsed.filter(isValidPlan);
        const snapshot: PlansSnapshot = {
          version: PLANS_SCHEMA_VERSION,
          updatedAt: new Date().toISOString(),
          data: plans,
        };
        await this.writeSnapshot(snapshot);
        return snapshot;
      }
      const env = parsed as Partial<PlansStorageEnvelope>;
      if (typeof env.version === "number" && typeof env.updatedAt === "string" && Array.isArray(env.plans)) {
        return {
          version: env.version,
          updatedAt: env.updatedAt,
          data: env.plans.filter(isValidPlan),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> {
    const envelope: PlansStorageEnvelope = {
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      plans: snapshot.data,
    };
    localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(envelope));
  }

  public async readPlans(): Promise<Plan[]> {
    const snapshot = await this.readSnapshot();
    return snapshot?.data ?? [];
  }

  public async writePlans(plans: Plan[]): Promise<void> {
    await this.writeSnapshot({
      version: PLANS_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      data: plans,
    });
  }

  public async readActivePlanId(): Promise<string | null> {
    return localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);
  }

  public async writeActivePlanId(id: string | null): Promise<void> {
    if (id === null) {
      localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
    } else {
      localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, id);
    }
  }
}
