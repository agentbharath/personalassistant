import { callClaude } from "@/lib/runtime/model-runtime";
import { answerNews } from "./news";

export function answerNewsForUser(query: string, userId: string, memoryContext = "", today?: string) {
  return answerNews(query, (params) => callClaude("news_digest", params, { userId, timeoutMs: 20_000 }), memoryContext, today);
}
