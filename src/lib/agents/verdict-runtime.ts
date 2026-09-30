import { callClaude } from "@/lib/runtime/model-runtime";
import { answerVerdict } from "./verdict";

export function answerVerdictForUser(query: string, userId: string, context: { role: string; content: string }[], memoryContext = "", today?: string) {
  return answerVerdict(query, context, (params) => callClaude("verdict_extraction", params, { userId, timeoutMs: 20_000 }), memoryContext, today);
}
