import { useCallback, useEffect, useState } from "react";
import { Plan } from "../../../types";
import { PlanService } from "../../../application/workout/PlanService";

interface UsePlansResult {
  plans: Plan[];
  activePlanId: string | null;
  isLoaded: boolean;
  createPlan: (label: string, sessionIds: string[]) => Promise<Plan>;
  updatePlan: (id: string, updates: Partial<Pick<Plan, "label" | "sessionIds">>) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;
  setActivePlan: (id: string | null) => Promise<void>;
}

export function usePlans(service: PlanService): UsePlansResult {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [activePlanId, setActivePlanIdState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [loadedPlans, loadedActiveId] = await Promise.all([
        service.getPlans(),
        service.getActivePlanId(),
      ]);
      if (!cancelled) {
        setPlans(loadedPlans);
        setActivePlanIdState(loadedActiveId);
        setIsLoaded(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [service]);

  const createPlan = useCallback(async (label: string, sessionIds: string[]) => {
    const newPlan = await service.createPlan(label, sessionIds);
    setPlans((prev) => [...prev, newPlan]);
    return newPlan;
  }, [service]);

  const updatePlan = useCallback(async (id: string, updates: Partial<Pick<Plan, "label" | "sessionIds">>) => {
    await service.updatePlan(id, updates);
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [service]);

  const deletePlan = useCallback(async (id: string) => {
    await service.deletePlan(id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
    setActivePlanIdState((prev) => (prev === id ? null : prev));
  }, [service]);

  const setActivePlan = useCallback(async (id: string | null) => {
    await service.setActivePlan(id);
    setActivePlanIdState(id);
  }, [service]);

  return { plans, activePlanId, isLoaded, createPlan, updatePlan, deletePlan, setActivePlan };
}
