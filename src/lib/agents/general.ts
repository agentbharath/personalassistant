import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { synthesizeSearchResults } from "@/lib/model/claude";
import { withPublicQueryCache } from "@/lib/cache/public-query-cache";

export async function answerPublicSearch(query: string) {
  return withPublicQueryCache(query, async () => {
    const research = await searchPublicWeb(query);
    const synthesized = research.sources.length ? await synthesizeSearchResults(query, research.sources) : research.answer;
    const answer = cleanText(synthesized ?? "");
    const sources = research.sources.slice(0, 4).map((source) => `- [${source.title}](${source.url})`).join("\n");
    const result = [answer, sources && `### Sources\n${sources}`].filter(Boolean).join("\n\n");
    return result || "I couldn’t find reliable current results for that query.";
  });
}

function cleanText(value: string) {
  return value.replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)").trim();
}
