import { describe, expect, it } from "vitest";
import { GENERATE_PLAN_LIMITS } from "../../api/_lib/planLimits";
import {
  CANCEL_NOTE,
  FREE_PRICE,
  PLAN_FACTS,
  PRO_PRICE,
  WHEN_PRO_ENDS,
  freePlanFeatures,
  freePlanSummary,
  proPlanFeatures,
} from "./planCatalog";

describe("the plan catalog never promises more or less than the server enforces", () => {
  it("AI plan limits match what generate-plan enforces", () => {
    expect(GENERATE_PLAN_LIMITS.free).toEqual({ maxRequests: PLAN_FACTS.free.aiPlansPerDay, windowSeconds: 86_400 });
    expect(GENERATE_PLAN_LIMITS.pro).toEqual({ maxRequests: PLAN_FACTS.pro.aiPlansPerHour, windowSeconds: 3_600 });
  });

  it("the Free sync period is the 30 days the database uses", () => {
    expect(PLAN_FACTS.free.syncEveryDays).toBe(30);
  });
});

describe("what the plans say", () => {
  it("shows the prices in pounds", () => {
    expect(FREE_PRICE).toBe("£0");
    expect(PRO_PRICE).toBe("£1.99");
  });

  it("does not promise Free accounts automatic sync", () => {
    const text = freePlanFeatures().join(" | ");
    expect(text).not.toMatch(/automatic/i);
    expect(text).toContain("one sync every 30 days");
    expect(text).toContain("1 per day");
    expect(text).toContain("7 days of history in the cloud");
  });

  it("gives Pro a concrete reason to pay", () => {
    const text = proPlanFeatures().join(" | ");
    expect(text).toContain("Automatic cloud sync");
    expect(text).toContain("10 AI plans per hour");
    expect(text).toContain("5,000 days");
  });

  it("every limit it quotes is the real one", () => {
    expect(freePlanFeatures().join(" ")).toContain(`${PLAN_FACTS.free.templates} session templates and ${PLAN_FACTS.free.plans} plans`);
    expect(proPlanFeatures().join(" ")).toContain(`${PLAN_FACTS.pro.templates} templates, ${PLAN_FACTS.pro.plans} plans`);
  });

  it("says that ending Pro deletes nothing, and no longer promises a grace period that does not exist", () => {
    expect(WHEN_PRO_ENDS).toMatch(/nothing is deleted/i);
    expect(CANCEL_NOTE).toMatch(/keep all of your data/i);
    expect(`${WHEN_PRO_ENDS} ${CANCEL_NOTE}`).not.toMatch(/grace/i);
  });

  it("summarises Free against Pro for the Settings card", () => {
    expect(freePlanSummary()).toContain("1 AI-generated plan per day");
    expect(freePlanSummary()).toContain("every 30 days");
    expect(freePlanSummary()).toContain("10 AI plans per hour");
  });
});
