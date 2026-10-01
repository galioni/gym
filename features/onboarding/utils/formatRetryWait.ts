const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** A wait in plain language, rounded up so nobody retries too early: "1 minute", "5 hours", "2 days". */
export function formatRetryWait(seconds: number): string {
  if (seconds <= MINUTE) return "1 minute";
  if (seconds < HOUR) return plural(Math.ceil(seconds / MINUTE), "minute");
  if (seconds <= 48 * HOUR) return plural(Math.ceil(seconds / HOUR), "hour");
  return plural(Math.ceil(seconds / DAY), "day");
}
