/**
 * What each plan may do on the server. One place, so the numbers cannot drift between the check, the message the
 * person reads and the tests. (Plan rules decided by the owner on 2026-10-01; see docs/NEXT_PHASES_README.md.)
 */
export interface RateRule {
  maxRequests: number;
  windowSeconds: number;
}

const HOUR = 3_600;
const DAY = 86_400;

export const GENERATE_PLAN_LIMITS = {
  free: { maxRequests: 1, windowSeconds: DAY },
  pro: { maxRequests: 10, windowSeconds: HOUR },
} as const satisfies Record<"free" | "pro", RateRule>;

export function generatePlanLimit(isPro: boolean): RateRule {
  return isPro ? GENERATE_PLAN_LIMITS.pro : GENERATE_PLAN_LIMITS.free;
}

/** The sentence a person sees when they are over the limit. Free users are told what Pro adds. */
export function describeGeneratePlanLimit(isPro: boolean): string {
  return isPro
    ? `You can generate up to ${GENERATE_PLAN_LIMITS.pro.maxRequests} plans per hour.`
    : `The Free plan includes ${GENERATE_PLAN_LIMITS.free.maxRequests} AI plan per day. Pro allows ${GENERATE_PLAN_LIMITS.pro.maxRequests} per hour.`;
}
