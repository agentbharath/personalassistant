import { createInterpretationCache } from "@/lib/agents/email-interpreter-runtime";
import { loadLearnings } from "@/lib/learning/store";
import { callClaude } from "@/lib/runtime/model-runtime";
import { routeMessage, type RouterInput } from "./router";

const cache = createInterpretationCache();

/** R19.2, R19.7: the production router, on the shared encrypted cache. Returns null when the rules must decide (R19.8). */
export async function routeForUser(input: RouterInput) {
  // A saved home location lets the router read "near me" without asking. A problem loading it never blocks routing.
  const homeLocation = input.homeLocation !== undefined ? input.homeLocation : (await loadLearnings(input.userId).catch(() => null))?.homeLocation ?? null;
  return routeMessage({ ...input, homeLocation }, { complete: (params) => callClaude("message_routing", params), cache });
}
