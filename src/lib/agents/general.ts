import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { synthesizeSearchResults } from "@/lib/model/claude";
import { withPublicQueryCache } from "@/lib/cache/public-query-cache";

export async function answerPublicSearch(query: string) {
  return withPublicQueryCache(query, async () => {
    const research = await searchPublicWeb(query);
    // The same numbered evidence goes to the model and to the reader, so a [3] in the answer is source 3 in the list below it.
    const evidence = research.sources.slice(0, 5);
    const synthesized = evidence.length ? await synthesizeSearchResults(query, evidence) : research.answer;
    const answer = cleanText(synthesized ?? "");
    const result = [answer, sourceList(answer, evidence)].filter(Boolean).join("\n\n");
    return result || "I couldn’t find reliable current results for that query.";
  });
}

/** The sources the answer cites, with the numbers it cites them by; if it cites none, the first few. */
export function sourceList(answer: string, evidence: Array<{ title: string; url: string }>) {
  const cited = [...new Set([...answer.matchAll(/\[(\d)\]/g)].map((match) => Number(match[1])))].filter((n) => n >= 1 && n <= evidence.length).sort((a, b) => a - b);
  const shown = cited.length ? cited : evidence.slice(0, 3).map((_, index) => index + 1);
  if (!shown.length) return "";
  return `### Sources\n${shown.map((n) => `- **${n}** · [${evidence[n - 1].title}](${evidence[n - 1].url})`).join("\n")}`;
}

function cleanText(value: string) {
  return value.replace(/^#{1,6}\s+/gm, "").replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)").trim();
}
