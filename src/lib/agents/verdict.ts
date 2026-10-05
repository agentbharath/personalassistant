import { cardFollowUpSchema, CARD_FOLLOW_UP_JSON_SCHEMA, CARD_FOLLOW_UP_RULES, cleanCardFollowUps } from "@/lib/chat/card-followups";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { embedCard, extractCards, type SuggestionCardPayload, type VerdictCardPayload } from "@/lib/chat/card-payload";
import { plain } from "./search-answer";
import { answerPublicSearch } from "./general";
import { reportFailure } from "@/lib/observability/report";

const TONE = ["good", "highlight", "neutral", "catch"] as const;
const outputSchema = z.object({
  kindLabel: z.string(),
  bottomLine: z.string(),
  rows: z.array(z.object({ item: z.number(), detail: z.string(), verdictLabel: z.string(), verdictTone: z.enum(TONE), source: z.number() })),
  chips: z.array(cardFollowUpSchema),
});
type Output = z.infer<typeof outputSchema>;
const JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kindLabel", "bottomLine", "rows", "chips"],
  properties: {
    kindLabel: { type: "string" },
    bottomLine: { type: "string" },
    rows: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["item", "detail", "verdictLabel", "verdictTone", "source"],
      properties: { item: { type: "number" }, detail: { type: "string" }, verdictLabel: { type: "string" }, verdictTone: { type: "string", enum: TONE as unknown as string[] }, source: { type: "number" } },
    } },
    chips: CARD_FOLLOW_UP_JSON_SCHEMA,
  },
} as const;

type Source = { title: string; url: string; snippet: string };
type Item = { name: string; meta: string; metric: string };
type ContextTurn = { role: string; content: string };

/** The most recent suggestions card shown in this conversation, as the options a follow-up like "are they good?" is about. The card
 * itself is the source of truth: its names and prices are carried over untouched, never re-derived or re-stated by a model. */
export function lastSuggestionItems(context: ContextTurn[]): { subject: string; items: Item[] } | null {
  for (const turn of [...context].reverse()) {
    if (turn.role !== "assistant") continue;
    for (const segment of [...extractCards(turn.content).segments].reverse()) {
      if (segment.card?.kind !== "suggestion") continue;
      const card: SuggestionCardPayload = segment.card;
      const items = [card.topPick, ...card.rows].map((entry) => ({ name: entry.name, meta: entry.meta, metric: entry.metric })).filter((entry) => entry.name.trim());
      if (items.length) return { subject: card.kindLabel, items };
    }
  }
  return null;
}

function buildCard(items: Item[], output: Output, sources: Source[], subject: string): VerdictCardPayload {
  const sourceUrl = (n: number) => Number.isInteger(n) && n >= 1 && n <= sources.length ? sources[n - 1].url : "";
  const cited: number[] = [];
  const rows = items.map((item, index) => {
    const row = output.rows.find((candidate) => candidate.item === index + 1);
    if (!row || !row.verdictLabel.trim()) return { name: item.name, metric: item.metric, detail: "No reviews found for this one", tag: { label: "Unrated", tone: "neutral" as const } };
    if (sourceUrl(row.source)) cited.push(row.source);
    return { name: item.name, metric: item.metric, detail: plain(row.detail, 120), tag: { label: plain(row.verdictLabel, 30), tone: row.verdictTone } };
  });
  const label = plain(output.kindLabel, 80);
  return {
    kind: "verdict",
    kindLabel: label || `Verdict on the ${items.length} options above`,
    basis: "Based on ratings and reviews",
    bottomLine: plain(output.bottomLine, 200),
    replyingTo: subject,
    rows,
    sources: [...new Set(cited)].map((n) => ({ label: plain(new URL(sources[n - 1].url).hostname.replace(/^www\./, ""), 60), url: sources[n - 1].url })),
    chips: cleanCardFollowUps(output.chips),
  };
}

function renderVerdictText(card: VerdictCardPayload): string {
  return [`### ${card.kindLabel}`, card.bottomLine, ...card.rows.map((row) => `**${row.name}** ${row.metric} — ${row.tag.label}: ${row.detail}`)].filter(Boolean).join("\n\n");
}

/**
 * A follow-up verdict on the options a suggestions card just showed ("are they good?", "which one should I get?"): a bottom line first,
 * then one row per earlier option with its own single verdict tag. Grounded in a fresh search for reviews of those exact products, never
 * in the model's memory of them -- an option the evidence doesn't cover is shown as "Unrated", not guessed at. Falls back to the plain
 * search whenever there's no earlier suggestions card in this conversation or nothing usable comes back.
 */
export async function answerVerdict(query: string, context: ContextTurn[], complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>, memoryContext = "", today?: string): Promise<string> {
  const fallback = () => answerPublicSearch(query, undefined, memoryContext, today);
  try {
    const earlier = lastSuggestionItems(context);
    if (!earlier) return fallback();
    const { subject, items } = earlier;
    // The question itself goes into the search: "medium fit reviews and sizing" needs fit and sizing reviews of these exact products, not their
    // generic star ratings (found live: the same generic verdict came back for every follow-up).
    const research = await searchPublicWeb(`${items.map((item) => item.name).join(", ")} ${query} reviews`.slice(0, 380), { depth: "advanced", maxResults: 8, snippetLength: 1200 });
    const sources = research.sources.slice(0, 8);
    if (!sources.length) return fallback();

    const options = items.map((item, index) => `${index + 1}. ${item.name} (${[item.metric, item.meta].filter(Boolean).join("; ")})`).join("\n");
    const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\nEvidence: ${source.snippet}`).join("\n\n");
    const response = await complete({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      temperature: 0,
      system: `The user was just shown these ${items.length} options for "${subject}" and asks: "${query}". Always refer to an option by its name, never by its number (the user never sees numbers). When the question names a specific aspect (fit, sizing, warmth, durability, price, comfort), the whole verdict is about THAT aspect: bottomLine answers it directly, each detail reports what the evidence says about it, and verdictLabel says how that option does on it (\"True to size\", \"Runs large\", \"Runs small\", \"Warm\"); an option whose evidence says nothing about that aspect is skipped, never filled with generic praise. For a general question (\"are they good?\") judge overall. Judge each one from the real review evidence given -- never from memory, never inventing a rating, review count or claim the evidence doesn't contain. kindLabel: a short title for what is judged: "Verdict on the ${items.length} <plural noun for what they are> above" for a general question ("Verdict on the 4 jackets above"), or for a specific aspect "<Aspect> on the ${items.length} <plural noun> above" ("Fit on the 4 jackets above"). bottomLine: one or two short sentences, under 120 characters in all, that answer the question directly and name what to get at what price or situation ("Around $70, get the Cotopaxi Abrazo. Under $40, Lands' End over Amazon."). rows: one per option, item = its number above, detail = one short line, under 60 characters, of what the reviews actually say (a rating and review count when the evidence gives them: "4.7 from 135 reviews, deepest discount"; else one real downside or strength: "Runs large, not very warm"), verdictLabel = one or two words ("Good buy", "Best long-term", "Solid budget", "Occasional wear"), verdictTone = "good" for a recommendation, "highlight" for a standout on one dimension, "neutral" for fine-but-unremarkable, "catch" for a real downside worth flagging, source = the evidence number behind the detail (0 if none). Skip an option the evidence says nothing about rather than guessing. ${CARD_FOLLOW_UP_RULES} Return JSON only.`,
      messages: [{ role: "user", content: `Options:\n${options}\n\nEvidence:\n${evidence}` }],
      output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") return fallback();
    const output = outputSchema.parse(JSON.parse(block.text));
    if (!output.bottomLine.trim() || !output.rows.some((row) => row.verdictLabel.trim())) return fallback();
    const card = buildCard(items, output, sources, subject);
    return embedCard(renderVerdictText(card), card);
  } catch (error) {
    reportFailure("verdict_failed", error, { query });
    return fallback();
  }
}
