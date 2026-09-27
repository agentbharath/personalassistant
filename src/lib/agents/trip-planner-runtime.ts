import { callClaude } from "@/lib/runtime/model-runtime";
import { runTripPlan, type TripPlannerDeps } from "./trip-planner";

/** The production wiring for the trip planner's two model calls: the real, budget-tracked, retrying `callClaude`, exactly like
 * `time-interpreter-runtime.ts` wires `interpretTime`. A live eval wires `trip-planner.ts`'s `runTripPlan` to a raw, spend-metered client
 * call instead (see `evals/trip-live.test.ts`), so the pipeline itself never has two versions — only this one thin seam does. */
export function runTripPlanForUser(destination: string, dateText: string, userId: string, context: { role: "user" | "assistant"; content: string }[] = []) {
  // callClaude's own default (10s) is right for a short classification call, not for extraction (thousands of evidence tokens in) or
  // composition (up to ~2400 output tokens on a slower "high"-tier model) — both genuinely take longer. 30s is callClaude's own ceiling
  // (found live, R32: extraction was timing out and failing outright at the 10s default, which isn't a retryable condition).
  const deps: TripPlannerDeps = { complete: (operation, params) => callClaude(operation, params, { userId, timeoutMs: 30_000 }) };
  return runTripPlan(destination, dateText, userId, context, deps);
}
