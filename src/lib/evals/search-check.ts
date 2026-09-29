import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SearchCase = {
  id: string;
  query: string;
  /** Any one of these (case-insensitive substring) satisfies the case -- alternate phrasings/units of the same fact, not a checklist. */
  expect: { contains: string[] };
};

export function loadSearchCases(): SearchCase[] {
  return readFileSync(resolve(process.cwd(), "evals", "search.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as SearchCase);
}

/** Problems with an answer, empty when it contains the specific fact asked for -- the one question this eval exists to answer, per the
 * user's own framing: not "is this well-written," just "does it actually have the number/name in it." */
export function checkSearch(answer: string, expected: SearchCase["expect"]): string[] {
  const lower = answer.toLowerCase();
  const hit = expected.contains.some((phrase) => lower.includes(phrase.toLowerCase()));
  return hit ? [] : [`answer does not contain any of ${JSON.stringify(expected.contains)}`];
}
