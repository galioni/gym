import { Plan } from "../../types";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { PlansSnapshot } from "../../application/sync/syncTypes";
import { PLANS_STORAGE_KEY, ACTIVE_PLAN_STORAGE_KEY, PLANS_SCHEMA_VERSION } from "../../constants";
import { migrateRawPlansSnapshot } from "../../application/sync/migrations/snapshotMigrations";

export class LocalStoragePlansRepository implements PlansRepository {
  public async readSnapshot(): Promise<PlansSnapshot | null> {
    const raw = localStorage.getItem(PLANS_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const snapshot: PlansSnapshot = migrateRawPlansSnapshot(parsed);
      await this.writeSnapshot(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }

  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> {
    if (snapshot.version > PLANS_SCHEMA_VERSION) {
      throw new Error(
        `Cannot write plans schema version ${snapshot.version}: app supports up to v${PLANS_SCHEMA_VERSION}.`
      );
    }
    localStorage.setItem(
      PLANS_STORAGE_KEY,
      JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        plans: snapshot.data,
      })
    );
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
