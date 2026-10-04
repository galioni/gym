import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatRetryWait } from "../features/onboarding/utils/formatRetryWait";

/**
 * User-facing API wording shared with the Flutter client (mobile/test/contract): the retry wait shown when plan
 * generation is rate limited. Regenerate after an intentional change with: UPDATE_CONTRACT=1 npx vitest run contract
 */
const FIXTURE = resolve(process.cwd(), "contract/api.fixtures.json");

const SECONDS = [
  0, 1, 59, 60, 61, 119, 120, 3599, 3600, 3601, 7199, 7200, 7201, 86_399, 86_400, 172_799, 172_800, 172_801,
  172_800 + 3600, 259_200, 259_201, 604_800,
];

function build() {
  return { retryWait: SECONDS.map((seconds) => ({ seconds, text: formatRetryWait(seconds) })) };
}

describe("api contract", () => {
  it("matches the golden fixture the Flutter client tests against", () => {
    const built = build();
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(built, null, 1)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(built);
  });
});
