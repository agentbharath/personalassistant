import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type PublicResearch = { answer?: string; sources: Array<{ title: string; url: string; snippet: string }> };

export async function searchPublicWeb(query: string, options: { domains?: string[] } = {}): Promise<PublicResearch> {
  assertToolAllowed("general", "web.search");
  const response = await resilientFetch("tavily", "https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", topic: "general", include_domains: options.domains, include_answer: false, max_results: 5, include_raw_content: false, include_images: false }),
  }, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) throw new Error(`PUBLIC_SEARCH_${response.status}`);
  const body = await response.json() as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
  return { answer: body.answer, sources: (body.results ?? []).flatMap((result) => result.title && result.url ? [{ title: result.title, url: result.url, snippet: (result.content ?? "").slice(0, 500) }] : []) };
}
