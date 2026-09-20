import { createInterpretationCache } from "@/lib/agents/email-interpreter-runtime";
import { callClaude } from "@/lib/runtime/model-runtime";
import { routeMessage, type RouterInput } from "./router";

const cache = createInterpretationCache();

/** R19.2, R19.7: the production router, on the shared encrypted cache. Returns null when the rules must decide (R19.8). */
export function routeForUser(input: RouterInput) {
  return routeMessage(input, { complete: (params) => callClaude("message_routing", params), cache });
}
