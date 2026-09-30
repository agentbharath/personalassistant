import { callClaude } from "@/lib/runtime/model-runtime";
import { answerCricketNews } from "./cricket-news";

export function answerCricketNewsForUser(query: string, userId: string, memoryContext = "", today?: string) {
  return answerCricketNews(query, (params) => callClaude("cricket_news_summary", params, { userId, timeoutMs: 20_000 }), memoryContext, today);
}
