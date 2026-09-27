import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type TripCase = {
  id: string;
  destination: string;
  dateText: string;
  today: string;
  /** A range, not an exact count, for a fuzzy phrase ("this upcoming Thanksgiving weekend") where more than one reading is genuinely
   * reasonable; an unambiguous phrase ("the weekend after next") can use minDays === maxDays. */
  expect: { minDays: number; maxDays: number; minSources: number };
};

export function loadTripCases(): TripCase[] {
  return readFileSync(resolve(process.cwd(), "evals", "trip.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as TripCase);
}

/** Checks only the itinerary's own promised shape on the real, rendered answer — the same things `critiqueItinerary` already checks
 * internally on the model's raw JSON, now checked end to end against what the live pipeline actually returns text-wise, so a schema-valid
 * but silently-empty or source-less render would still be caught. Never grades taste or quality: a live eval measures whether the pipeline
 * kept its own promise, the same as every other check in this directory (R21). */
export function checkTrip(answer: string, expected: TripCase["expect"]): string[] {
  const problems: string[] = [];
  const dayHeaders = answer.match(/^#### .+$/gm) ?? [];
  if (dayHeaders.length < expected.minDays || dayHeaders.length > expected.maxDays) problems.push(`${dayHeaders.length} day section(s), expected ${expected.minDays}-${expected.maxDays}`);
  if (dayHeaders.length && !/\n- .+/.test(answer)) problems.push("no stop lines under any day");
  const sourceLines = answer.match(/^- \*\*\d+\*\* ·/gm) ?? [];
  if (expected.minSources > 0 && !answer.includes("### Sources")) problems.push("no Sources section");
  if (sourceLines.length < expected.minSources) problems.push(`${sourceLines.length} source(s) listed, expected at least ${expected.minSources}`);
  return problems;
}
