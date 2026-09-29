import { callClaude } from "@/lib/runtime/model-runtime";
import { runResearch, type ResearchDeps } from "./research";

/** The production wiring for research mode's two model calls: the real, budget-tracked, retrying `callClaude`, exactly like
 * trip-planner-runtime.ts wires the trip planner. A live eval wires `research.ts`'s `runResearch` to a raw, spend-metered client call
 * instead, so the pipeline itself never has two versions -- only this one thin seam does. */
export function runResearchForUser(subject: string, options: string[], userId: string) {
  // callClaude's own default (10s) is right for a short classification call, not for extraction (thousands of evidence tokens in) or
  // composition on a slower "high"-tier model -- both genuinely take longer, the same reasoning the trip planner's own wiring applies.
  const deps: ResearchDeps = { complete: (operation, params) => callClaude(operation, params, { userId, timeoutMs: 30_000 }) };
  return runResearch(subject, options, deps);
}
