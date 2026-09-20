import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { synthesizeSearchResults } from "@/lib/model/claude";
import { cleanModelText, renderSearchAnswer, plain } from "./search-answer";
import { withPublicQueryCache } from "@/lib/cache/public-query-cache";

export type SearchPlaces = Array<{ name: string; address: string; note: string }>;
/** Called with what the search showed, so a follow-up can point at it. Best effort. */
export type RememberSearch = (state: { query: string; places: SearchPlaces }) => Promise<void>;

type Loaded = { text: string; places: SearchPlaces };

export async function answerPublicSearch(query: string, remember?: RememberSearch) {
  // The saved value is the finished answer and the places in it, so a cached answer can still be followed up.
  const raw = await withPublicQueryCache(query, async () => JSON.stringify(await loadAnswer(query)));
  const { text, places } = parseLoaded(raw);
  if (places.length && remember) await remember({ query, places }).catch(() => undefined);
  return text;
}

async function loadAnswer(query: string): Promise<Loaded> {
  const research = await searchPublicWeb(query);
  // The same numbered evidence goes to the model and to the reader, so a [3] in the answer is source 3 in the list below it.
  const evidence = research.sources.slice(0, 5);
  const structured = evidence.length ? await synthesizeSearchResults(query, evidence) : null;
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
