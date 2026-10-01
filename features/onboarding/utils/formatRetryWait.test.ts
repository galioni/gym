import { describe, expect, it } from "vitest";
import { formatRetryWait } from "./formatRetryWait";

describe("formatRetryWait", () => {
  it("never says zero or less than a minute", () => {
    expect(formatRetryWait(1)).toBe("1 minute");
    expect(formatRetryWait(60)).toBe("1 minute");
  });

  it("rounds minutes up so nobody retries too early", () => {
    expect(formatRetryWait(61)).toBe("2 minutes");
    expect(formatRetryWait(3_599)).toBe("60 minutes");
  });

  it("switches to hours for a daily limit instead of a four-digit minute count", () => {
    expect(formatRetryWait(3_600)).toBe("1 hour");
    expect(formatRetryWait(3_601)).toBe("2 hours");
    expect(formatRetryWait(86_400)).toBe("24 hours");
    expect(formatRetryWait(82_800)).toBe("23 hours");
  });

  it("uses days beyond two days", () => {
    expect(formatRetryWait(48 * 3_600)).toBe("48 hours");
    expect(formatRetryWait(48 * 3_600 + 1)).toBe("3 days");
  });
});
