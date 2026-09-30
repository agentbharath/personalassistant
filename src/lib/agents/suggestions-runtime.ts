import { callClaude } from "@/lib/runtime/model-runtime";
import { answerSuggestions } from "./suggestions";

export function answerSuggestionsForUser(query: string, userId: string, memoryContext = "", today?: string) {
  return answerSuggestions(query, (params) => callClaude("suggestion_extraction", params, { userId, timeoutMs: 20_000 }), memoryContext, today);
}
