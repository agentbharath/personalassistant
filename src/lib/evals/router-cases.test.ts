import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseRouterCases, routerEvalError } from "./router-cases";

it("validates every router fixture offline, including unique ledger IDs", () => {
  const cases = parseRouterCases(readFileSync("evals/router.jsonl", "utf8"));
  expect(cases.length).toBeGreaterThanOrEqual(333);
});
it("rejects duplicate IDs before a live run", () => {
  const row = JSON.stringify({ id: "same", rule: "R21", input: "hi", expect: { operation: "casual" } });
  expect(() => parseRouterCases(`${row}\n${row}`)).toThrow("Duplicate router case ID");
});
it("preserves the provider's rejection reason and request ID for diagnosis", () => {
  const diagnostic = routerEvalError({ status: 400, request_id: "req_test", error: { error: { message: "Invalid schema" } } });
  expect(JSON.parse(diagnostic)).toEqual({ status: 400, requestId: "req_test", detail: "Invalid schema" });
});
