import { describe, expect, it } from "vitest";
import { createSessionType, getSessionLabel, getSessionOptions, normalizeSessionTypeId } from "./sessionTypeRules";
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

describe("normalizeSessionTypeId", () => {
  it("returns null for all-whitespace input", () => {
    expect(normalizeSessionTypeId("   ")).toBeNull();
    expect(normalizeSessionTypeId("")).toBeNull();
    expect(normalizeSessionTypeId("\t\n")).toBeNull();
  });

  it("converts unicode and special characters to hyphens", () => {
    expect(normalizeSessionTypeId("Yoga & Stretch")).toBe("yoga-stretch");
    expect(normalizeSessionTypeId("café latte")).toBe("caf-latte");
    expect(normalizeSessionTypeId("HIIT!@#cardio")).toBe("hiit-cardio");
  });

  it("collapses consecutive special characters into a single hyphen", () => {
    expect(normalizeSessionTypeId("upper -- body")).toBe("upper-body");
    expect(normalizeSessionTypeId("A   B   C")).toBe("a-b-c");
    expect(normalizeSessionTypeId("!!start!!")).toBe("start");
  });

  it("strips leading and trailing hyphens after normalization", () => {
    expect(normalizeSessionTypeId("---hi---")).toBe("hi");
    expect(normalizeSessionTypeId("  Gym  ")).toBe("gym");
  });

  it("truncates to 32 characters", () => {
    const long = "a".repeat(40);
    const result = normalizeSessionTypeId(long);
    expect(result).toHaveLength(32);
    expect(result).toBe("a".repeat(32));
  });

  it("accepts numeric-only labels", () => {
    expect(normalizeSessionTypeId("100")).toBe("100");
    expect(normalizeSessionTypeId("  42  ")).toBe("42");
  });
});