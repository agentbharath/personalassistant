import { ensureRequestTime } from "@/lib/runtime/request-context";
import { callClaude } from "@/lib/runtime/model-runtime";
import { answerNews } from "./news";

export function answerNewsForUser(query: string, userId: string, memoryContext = "", today?: string) {
  // Routing, search and structured extraction share one deadline; an optional wider news pass is still bounded.
  ensureRequestTime(60_000);
  return answerNews(query, (params) => callClaude("news_digest", params, { userId, timeoutMs: 30_000 }), memoryContext, today);
}
