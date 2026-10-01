import { Plan, Templates } from "../../types";
import { Collection } from "./syncMerge";
import { SyncedSettings } from "./syncTypes";

/**
 * Adapters between the snapshot shapes the repositories speak and the keyed Collection the merge speaks.
 * Each pair is lossless: fromCollection(toCollection(x)) equals x.
 */

export function templatesToCollection(templates: Templates): Collection<Templates[string]> {
  return { keys: Object.keys(templates), items: { ...templates } };
}

export function collectionToTemplates(collection: Collection<Templates[string]>): Templates {
  return Object.fromEntries(collection.keys.map((key) => [key, collection.items[key]]));
}

export function plansToCollection(plans: Plan[]): Collection<Plan> {
  return { keys: plans.map((plan) => plan.id), items: Object.fromEntries(plans.map((plan) => [plan.id, plan])) };
}

export function collectionToPlans(collection: Collection<Plan>): Plan[] {
  return collection.keys.map((key) => collection.items[key]);
}

const SETTINGS_FIELDS = ["activePlanId", "planParams", "planMeta"] as const;

/** A null field is "not set", so setting it to null on one device is a deletion the merge can propagate. */
export function settingsToCollection(settings: SyncedSettings): Collection<unknown> {
  const keys = SETTINGS_FIELDS.filter((field) => settings[field] !== null);
  return { keys: [...keys], items: Object.fromEntries(keys.map((field) => [field, settings[field]])) };
}

export function collectionToSettings(collection: Collection<unknown>): SyncedSettings {
  const value = (field: (typeof SETTINGS_FIELDS)[number]) =>
    Object.hasOwn(collection.items, field) ? collection.items[field] : null;
  return {
    activePlanId: value("activePlanId") as SyncedSettings["activePlanId"],
    planParams: value("planParams") as SyncedSettings["planParams"],
    planMeta: value("planMeta") as SyncedSettings["planMeta"],
  };
}
