import { describe, expect, it } from "vitest";
import { createSessionType, getSessionLabel, getSessionOptions } from "./sessionTypeRules";
import { TEMPLATES } from "../../../constants";

describe("sessionTypeRules", () => {
  it("creates a new custom session type with an empty template", () => {
    const result = createSessionType(TEMPLATES, "Mobility Flow");

    expect(result.status).toBe("success");
    expect(result.sessionType).toBe("mobility-flow");
    expect(result.templates?.["mobility-flow"]).toEqual({ warmup: [], main: [] });
  });

  it("rejects duplicate session type ids", () => {
    const result = createSessionType(TEMPLATES, "Gym");

    expect(result.status).toBe("error");
    expect(result.message).toContain("already exists");
  });

  it("returns built-in options first and custom options after them", () => {
    const options = getSessionOptions({
      ...TEMPLATES,
      mobility: { warmup: [], main: [] },
      conditioning: { warmup: [], main: [] },
    });

    expect(options.slice(0, 4).map((option) => option.value)).toEqual([
      "tennis",
      "gym",
      "swim",
      "rest",
    ]);
    expect(options.slice(4).map((option) => option.label)).toEqual(["Conditioning", "Mobility"]);
    expect(getSessionLabel("mobility-flow")).toBe("Mobility Flow");
  });
});