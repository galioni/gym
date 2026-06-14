import { describe, expect, it } from "vitest";
import { runWorkoutSmokeChecks } from "./runWorkoutSmokeChecks";

/**
 * Automated equivalent of the ?qa=1 smoke panel.
 * All cases must pass on every CI run — a failure here means a regression
 * in the core workout state transitions.
 */
describe("QA smoke checks (?qa=1 equivalent)", () => {
  it("all smoke cases pass", async () => {
    const results = await runWorkoutSmokeChecks();

    const failing = results.filter((r) => !r.pass);
    if (failing.length > 0) {
      const details = failing.map((r) => `  - ${r.name}: ${r.detail}`).join("\n");
      throw new Error(`${failing.length} smoke check(s) failed:\n${details}`);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(failing).toHaveLength(0);
  });
});
