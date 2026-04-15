import { Plan } from "../../types";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";

export class PlanService {
  public constructor(private readonly repository: PlansRepository) {}

  public async getPlans(): Promise<Plan[]> {
    return this.repository.readPlans();
  }

  public async getActivePlanId(): Promise<string | null> {
    return this.repository.readActivePlanId();
  }

  public async createPlan(label: string, sessionIds: string[]): Promise<Plan> {
    const plans = await this.repository.readPlans();
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newPlan: Plan = { id, label: label.trim(), sessionIds };
    await this.repository.writePlans([...plans, newPlan]);
    return newPlan;
  }

  public async updatePlan(id: string, updates: Partial<Pick<Plan, "label" | "sessionIds">>): Promise<void> {
    const plans = await this.repository.readPlans();
    const next = plans.map((p) => (p.id === id ? { ...p, ...updates } : p));
    await this.repository.writePlans(next);
  }

  public async deletePlan(id: string): Promise<void> {
    const plans = await this.repository.readPlans();
    await this.repository.writePlans(plans.filter((p) => p.id !== id));
    const activePlanId = await this.repository.readActivePlanId();
    if (activePlanId === id) {
      await this.repository.writeActivePlanId(null);
    }
  }

  public async setActivePlan(id: string | null): Promise<void> {
    await this.repository.writeActivePlanId(id);
  }
}
