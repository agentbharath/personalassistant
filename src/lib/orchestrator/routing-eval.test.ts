import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDeterministicRouteForEval } from "./routing";

type RoutingCase = { id: string; input: string; expectedRoute: string };

const cases = readFileSync(resolve(process.cwd(), "evals/routing.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RoutingCase);

describe("routing evaluation dataset", () => {
  for (const example of cases) {
    it(example.id, () => {
      expect(classifyDeterministicRouteForEval(example.input)).toBe(example.expectedRoute);
    });
  }
});
