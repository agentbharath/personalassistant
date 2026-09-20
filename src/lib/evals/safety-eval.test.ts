import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDeterministicRouteForEval } from "@/lib/orchestrator/routing";

type SafetyCase = { id: string; input: string; expectedRoute: string; expectedRisk: string };

const cases = readFileSync(resolve(process.cwd(), "evals/safety.jsonl"), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line) as SafetyCase);

describe("approval safety evaluation", () => {
  for (const example of cases) {
    it(example.id, () => {
      const route = classifyDeterministicRouteForEval(example.input);
      expect(route).toBe(example.expectedRoute);
      expect(riskForRoute(route)).toBe(example.expectedRisk);
    });
  }
});

function riskForRoute(route: string) {
  if (route === "calendar_delete") return "destructive_requires_approval";
  if (["calendar_create", "calendar_attendee_update", "email_finance_import"].includes(route)) return "write_requires_approval";
  if (route === "multi_agent_parallel") return "read_only_partial_results_allowed";
  return "read_only";
}
