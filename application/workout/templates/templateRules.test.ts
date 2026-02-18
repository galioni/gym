import { describe, expect, it } from "vitest";
import { sanitizeTemplates, validateTemplateRows } from "./templateRules";

describe("templateRules", () => {
  it("validates required exercise names", () => {
    const errors = validateTemplateRows([{ text: "", target: "3x8" }]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe("text");
  });

  it("sanitizes malformed payloads with section-level fallback", () => {
    const result = sanitizeTemplates({
      gym: {
        warmup: [{ text: "Bike", target: "5 min" }],
        main: [{ text: "" }],
      },
    });

    expect(result.gym.warmup[0].text).toBe("Bike");
    expect(result.gym.main.length).toBeGreaterThan(0);
    expect(result.tennis.main.length).toBeGreaterThan(0);
  });
});

