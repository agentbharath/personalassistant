import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { synthesizeSearchResults } from "@/lib/model/claude";
import { cleanModelText, renderSearchAnswer, plain } from "./search-answer";
import { withPublicQueryCache } from "@/lib/cache/public-query-cache";

// v2: general search moved from basic-depth, 500-char-truncated evidence to advanced depth with real per-source chunks (R42, found live:
// thin/stale-reading answers traced to evidence that never had the answer in it, not a synthesis-prompt problem). See evals/search.jsonl.
// v3: one capped re-search round (R43) when synthesis's own "sufficient" field says the first search didn't actually answer the question --
// folded into the existing synthesis call (a new sufficient/missingQuery field on the same response), not a separate judgment call before
// it, so the common case (evidence already answers it) pays no extra latency at all; only a genuine gap pays for the retry round.
export const GENERAL_SEARCH_VERSION = "general-search-v3";

export type SearchPlaces = Array<{ name: string; address: string; note: string }>;
/** Called with what the search showed, so a follow-up can point at it. Best effort. */
export type RememberSearch = (state: { query: string; places: SearchPlaces }) => Promise<void>;

type Loaded = { text: string; places: SearchPlaces };

/** R31: memoryContext personalizes a recommendation-style search ("suggest a collagen supplement") with the person's own stated facts. It
 * also folds into the cache key, so a personalized answer is never served back for a different (or since-changed) fact set. `today` lets
 * synthesis tell a stale, differently-dated source ("Nov 27, 2025") apart from a confirmed date for the year actually being asked about.
 * `homeRegion` (the saved home location) keeps a price-comparison answer from leading with a foreign source's currency (found live, R32:
 * UK £ prices led a US-based person's protein-powder recommendation). */
export async function answerPublicSearch(query: string, remember?: RememberSearch, memoryContext = "", today?: string, homeRegion?: string) {
  // The saved value is the finished answer and the places in it, so a cached answer can still be followed up.
  const raw = await withPublicQueryCache(query, async () => JSON.stringify(await loadAnswer(query, memoryContext, today, homeRegion)), memoryContext);
  const { text, places } = parseLoaded(raw);
  if (places.length && remember) await remember({ query, places }).catch(() => undefined);
  return text;
}

const SEARCH_OPTS = { depth: "advanced" as const, maxResults: 6, snippetLength: 1500 };
function byUrl<T extends { url: string }>(rows: T[]): T[] { return [...new Map(rows.map((row) => [row.url, row])).values()]; }

async function loadAnswer(query: string, memoryContext: string, today?: string, homeRegion?: string): Promise<Loaded> {
  // Advanced depth + real per-source chunks + no 500-char truncation (found live: a basic-depth snippet is often a generic page summary,
  // not the passage that actually answers the question -- no amount of synthesis prompting recovers a fact the evidence never had).
  // maxResults asks for one extra over what's actually shown (evidence below stays capped at 5): a couple of raw results are routinely
  // dropped for missing a title/url, and this is a free buffer against that, not extra data being discarded on purpose.
  const research = await searchPublicWeb(query, SEARCH_OPTS);
  // The same numbered evidence goes to the model and to the reader, so a [3] in the answer is source 3 in the list below it.
  let evidence = research.sources.slice(0, 5);
  let structured = evidence.length ? await synthesizeSearchResults(query, evidence, memoryContext, today, homeRegion) : null;

  // One capped re-search round (R43), only when synthesis's own read of its evidence said the question genuinely wasn't answered --
  // never looping again on the retry's own result, so this can add at most one more search + one more synthesis call, never a chain.
  if (structured && !structured.sufficient && structured.missingQuery) {
    const retry = await searchPublicWeb(structured.missingQuery, SEARCH_OPTS).catch(() => null);
    if (retry?.sources.length) {
      // The retry's own results lead (they were fetched specifically to fill the identified gap), backfilled with the original
      // evidence up to the same five-source cap; a source appearing in both rounds is kept once, from wherever it appeared first.
      const merged = byUrl([...retry.sources, ...evidence]).slice(0, 5);
      const better = await synthesizeSearchResults(query, merged, memoryContext, today, homeRegion);
      if (better) { structured = better; evidence = merged; }
    }
  }

  const answer = structured ? renderSearchAnswer(structured, query, evidence.length) : cleanModelText(research.answer ?? "");
  const text = [answer, sourceList(answer, evidence)].filter(Boolean).join("\n\n") || "I couldn’t find reliable current results for that query.";
  const places = structured?.kind === "places" ? structured.items.slice(0, 5).map((item) => ({ name: plain(item.name, 80), address: plain(item.address, 120), note: plain(item.note, 140) })).filter((place) => place.name) : [];
  return { text, places };
}

/** Older saved answers were plain text; both forms are read, and so is one a cache already parsed into an object. */
function parseLoaded(raw: unknown): Loaded {
  try {
    const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<Loaded> | null;
    if (value && typeof value.text === "string") return { text: value.text, places: Array.isArray(value.places) ? value.places : [] };
  } catch { /* plain text from an older version */ }
  return { text: typeof raw === "string" ? raw : "I couldn’t read that saved answer. Please ask again.", places: [] };
}

/** The sources the answer cites, with the numbers it cites them by; if it cites none, the first few. */
export function sourceList(answer: string, evidence: Array<{ title: string; url: string }>) {
  const cited = [...new Set([...answer.matchAll(/\[(\d)\]/g)].map((match) => Number(match[1])))].filter((n) => n >= 1 && n <= evidence.length).sort((a, b) => a - b);
  const shown = cited.length ? cited : evidence.slice(0, 3).map((_, index) => index + 1);
  if (!shown.length) return "";
  return `### Sources\n${shown.map((n) => `- **${n}** · [${plain(evidence[n - 1].title, 120)}](${evidence[n - 1].url})`).join("\n")}`;
}
