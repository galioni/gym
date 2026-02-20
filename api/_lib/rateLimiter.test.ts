import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rateLimiter";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the window limit and blocks overflow", () => {
    let nowMs = 1_000;
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      now: () => nowMs,
    });

    expect(limiter.consume("client-a").allowed).toBe(true);
    expect(limiter.consume("client-a").allowed).toBe(true);

    const blocked = limiter.consume("client-a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);

    nowMs = 2_100;
    expect(limiter.consume("client-a").allowed).toBe(true);
  });

  it("tracks each key independently", () => {
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: 10_000,
      now: () => 5_000,
    });

    expect(limiter.consume("client-a").allowed).toBe(true);
    expect(limiter.consume("client-b").allowed).toBe(true);
    expect(limiter.consume("client-a").allowed).toBe(false);
  });
});
