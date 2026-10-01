import { describe, expect, it } from "vitest";
import { describeGeneratePlanLimit, generatePlanLimit } from "./planLimits";

describe("generate-plan limits per plan", () => {
  it("gives a free account one plan per rolling day", () => {
    expect(generatePlanLimit(false)).toEqual({ maxRequests: 1, windowSeconds: 86_400 });
  });

  it("gives a Pro account ten per rolling hour", () => {
    expect(generatePlanLimit(true)).toEqual({ maxRequests: 10, windowSeconds: 3_600 });
  });

  it("explains the free limit and what Pro adds", () => {
    expect(describeGeneratePlanLimit(false)).toBe("The Free plan includes 1 AI plan per day. Pro allows 10 per hour.");
  });

  it("explains the Pro limit without selling", () => {
    expect(describeGeneratePlanLimit(true)).toBe("You can generate up to 10 plans per hour.");
  });
});
