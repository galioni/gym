import { describe, expect, it } from "vitest";
import { PlanService } from "./PlanService";
import { PlansRepository } from "../../interfaces/workout/PlansRepository";
import { Plan } from "../../types";
import { PlansSnapshot } from "../sync/syncTypes";

class InMemoryPlansRepository implements PlansRepository {
  private plans: Plan[] = [];
  private activePlanId: string | null = null;
  private snapshot: PlansSnapshot | null = null;

  public async readPlans(): Promise<Plan[]> {
    return this.plans;
  }

  public async writePlans(plans: Plan[]): Promise<void> {
    this.plans = plans;
  }

  public async readActivePlanId(): Promise<string | null> {
    return this.activePlanId;
  }

  public async writeActivePlanId(id: string | null): Promise<void> {
    this.activePlanId = id;
  }

  public async readSnapshot(): Promise<PlansSnapshot | null> {
    return this.snapshot;
  }

  public async writeSnapshot(snapshot: PlansSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}

describe("PlanService", () => {
  it("creates a plan with a unique id", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);

    const plan = await service.createPlan("Strength block", ["gym", "rest"]);

    expect(plan.label).toBe("Strength block");
    expect(plan.sessionIds).toEqual(["gym", "rest"]);
    expect(typeof plan.id).toBe("string");
    expect(plan.id.length).toBeGreaterThan(0);

    const stored = await repo.readPlans();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(plan.id);
  });

  it("creates multiple plans without overwriting existing ones", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);

    await service.createPlan("Plan A", ["gym"]);
    await service.createPlan("Plan B", ["rest"]);

    const stored = await repo.readPlans();
    expect(stored).toHaveLength(2);
    expect(stored.map((p) => p.label)).toEqual(["Plan A", "Plan B"]);
  });

  it("updates plan label and sessionIds", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);
    const plan = await service.createPlan("Old name", ["gym"]);

    await service.updatePlan(plan.id, { label: "New name", sessionIds: ["gym", "swim"] });

    const stored = await repo.readPlans();
    expect(stored[0].label).toBe("New name");
    expect(stored[0].sessionIds).toEqual(["gym", "swim"]);
  });

  it("deletes a plan by id", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);
    const a = await service.createPlan("A", []);
    await service.createPlan("B", []);

    await service.deletePlan(a.id);

    const stored = await repo.readPlans();
    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe("B");
  });

  it("clears active plan when the active plan is deleted", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);
    const plan = await service.createPlan("Active", ["gym"]);
    await service.setActivePlan(plan.id);

    expect(await repo.readActivePlanId()).toBe(plan.id);

    await service.deletePlan(plan.id);

    expect(await repo.readActivePlanId()).toBeNull();
  });

  it("does not clear active plan when a different plan is deleted", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);
    const a = await service.createPlan("A", []);
    const b = await service.createPlan("B", []);
    await service.setActivePlan(b.id);

    await service.deletePlan(a.id);

    expect(await repo.readActivePlanId()).toBe(b.id);
  });

  it("sets and clears active plan", async () => {
    const repo = new InMemoryPlansRepository();
    const service = new PlanService(repo);
    const plan = await service.createPlan("Plan", []);

    await service.setActivePlan(plan.id);
    expect(await service.getActivePlanId()).toBe(plan.id);

    await service.setActivePlan(null);
    expect(await service.getActivePlanId()).toBeNull();
  });
});
