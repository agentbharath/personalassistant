import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type PublicResearch = { answer?: string; sources: Array<{ title: string; url: string; snippet: string }> };

/** `depth`/`maxResults`/`snippetLength` default to a plain single lookup (a restaurant, an opening time). Trip research (`trip-planner.ts`)
 * asks for `"advanced"` and more, longer results: several short-answer facts are not the same job as gathering enough real material to build
 * a multi-day plan from. Depth is real Tavily cost per call; callers that fan out several queries should know that going in. */
export async function searchPublicWeb(query: string, options: { domains?: string[]; depth?: "basic" | "advanced"; maxResults?: number; snippetLength?: number } = {}): Promise<PublicResearch> {
  assertToolAllowed("general", "web.search");
  const maxResults = options.maxResults ?? 5;
  const snippetLength = options.snippetLength ?? 500;
  const response = await resilientFetch("tavily", "https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, search_depth: options.depth ?? "basic", topic: "general", include_domains: options.domains, include_answer: false, max_results: maxResults, include_raw_content: false, include_images: false }),
  }, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) throw new Error(`PUBLIC_SEARCH_${response.status}`);
  const body = await response.json() as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
  return { answer: body.answer, sources: (body.results ?? []).flatMap((result) => result.title && result.url ? [{ title: result.title, url: result.url, snippet: (result.content ?? "").slice(0, snippetLength) }] : []) };
}
