import { callClaude } from "@/lib/runtime/model-runtime";
import { createInterpretationCache } from "./email-interpreter-runtime";
import { interpretTime, type TimeInput } from "./time-interpreter";

const cache = createInterpretationCache();

export function interpretTimeForUser(input: TimeInput) {
  return interpretTime(input, { complete: (params) => callClaude("time_interpretation", params, { userId: input.userId }), cache });
}
