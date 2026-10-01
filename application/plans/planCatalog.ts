/**
 * What each plan includes, in one place, so the landing page, Settings and the upgrade prompts cannot disagree with each
 * other. The enforced numbers live elsewhere and must match these (a test checks the ones in TypeScript):
 *   - AI plan generation: api/_lib/planLimits.ts
 *   - rows in the cloud:  supabase/migrations/*_plan_row_limits.sql (row_limit)
 *   - the monthly sync:   supabase/migrations/*_sync_allowance.sql
 * Owner decisions of 2026-10-01; see docs/NEXT_PHASES_README.md.
 */

export const FREE_PRICE = "£0";
export const PRO_PRICE = "£1.99";

export const PLAN_FACTS = {
  free: {
    templates: 5,
    plans: 20,
    aiPlansPerDay: 1,
    syncEveryDays: 30,
    historyDays: 7,
  },
  pro: {
    templates: 200,
    plans: 100,
    days: 5000,
    aiPlansPerHour: 10,
  },
} as const;

const count = (n: number) => n.toLocaleString("en-GB");

export function freePlanFeatures(): string[] {
  const f = PLAN_FACTS.free;
  return [
    "Daily workout tracking, on this device and offline",
    `AI plan generation (Gemini): ${f.aiPlansPerDay} per day`,
    `Up to ${f.templates} session templates and ${f.plans} plans`,
    `Cloud sync: one sync every ${f.syncEveryDays} days, started by you`,
    `${f.historyDays} days of history in the cloud (older entries stay on your device)`,
    "Backup export / import",
    "Installable on iOS & Android",
  ];
}

export function proPlanFeatures(): string[] {
  const p = PLAN_FACTS.pro;
  return [
    "Everything in Free",
    "Automatic cloud sync across all your devices, with no limit",
    `${p.aiPlansPerHour} AI plans per hour, and your choice of model (Claude, ChatGPT, Gemini)`,
    `Up to ${p.templates} templates, ${p.plans} plans and ${count(p.days)} days in the cloud`,
  ];
}

/** Said wherever someone can cancel or has cancelled: ending Pro never costs them their data. */
export const WHEN_PRO_ENDS =
  "If Pro ends, nothing is deleted. Everything stays on your device and in the cloud and you can still edit it; you just can't add beyond the Free limits until you upgrade again or delete something.";

export const CANCEL_NOTE = "No contracts. Cancel anytime. If Pro ends you keep all of your data.";

/** One line for the Free subscription card in Settings. */
export function freePlanSummary(): string {
  const f = PLAN_FACTS.free;
  const p = PLAN_FACTS.pro;
  return `Free includes ${f.aiPlansPerDay} AI-generated plan per day and one cloud sync every ${f.syncEveryDays} days. Pro adds automatic sync on every device, ${p.aiPlansPerHour} AI plans per hour with your choice of model, and higher limits.`;
}
