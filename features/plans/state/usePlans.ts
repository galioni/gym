import { useStaleReadGuard } from "../../sync/state/useStaleReadGuard";
import { useCallback, useEffect, useState } from "react";
import { Plan } from "../../../types";
import { PlanService } from "../../../application/workout/PlanService";

interface UsePlansResult {
  plans: Plan[];
  activePlanId: string | null;
  isLoaded: boolean;
  createPlan: (label: string, sessionIds: string[], schedule?: Plan["schedule"]) => Promise<Plan>;
  updatePlan: (id: string, updates: Partial<Pick<Plan, "label" | "sessionIds" | "schedule">>) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;
  setActivePlan: (id: string | null) => Promise<void>;
}

export function usePlans(service: PlanService, reloadToken = 0): UsePlansResult {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [activePlanId, setActivePlanIdState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { track, readFresh } = useStaleReadGuard();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Not a read that an edit overtook (see useStaleReadGuard): that would undo the edit on screen.
      const fresh = await readFresh(
        () => Promise.all([service.getPlans(), service.getActivePlanId()]),
        () => cancelled
      );
      if (fresh && !cancelled) {
        setPlans(fresh.value[0]);
        setActivePlanIdState(fresh.value[1]);
      }
      if (!cancelled) setIsLoaded(true);
    };
    void load();
    return () => { cancelled = true; };
  }, [service, reloadToken, readFresh]);

  // Each edit is tracked together with the state update that follows its save, so a re-read cannot land between the two.
  const createPlan = useCallback((label: string, sessionIds: string[], schedule?: Plan["schedule"]) => track((async () => {
    const newPlan = await service.createPlan(label, sessionIds, schedule);
    setPlans((prev) => [...prev, newPlan]);
    return newPlan;
  })()), [service, track]);

  const updatePlan = useCallback((id: string, updates: Partial<Pick<Plan, "label" | "sessionIds" | "schedule">>) => track((async () => {
    await service.updatePlan(id, updates);
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  })()), [service, track]);

  const deletePlan = useCallback((id: string) => track((async () => {
    await service.deletePlan(id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
    setActivePlanIdState((prev) => (prev === id ? null : prev));
  })()), [service, track]);

  const setActivePlan = useCallback((id: string | null) => track((async () => {
    await service.setActivePlan(id);
    setActivePlanIdState(id);
  })()), [service, track]);

  return { plans, activePlanId, isLoaded, createPlan, updatePlan, deletePlan, setActivePlan };
}
