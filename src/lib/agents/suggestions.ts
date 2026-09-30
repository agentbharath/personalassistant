import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { embedCard, type SuggestionCardPayload } from "@/lib/chat/card-payload";
import { plain } from "./search-answer";
import { answerPublicSearch } from "./general";
import { reportFailure } from "@/lib/observability/report";

const TONE = ["good", "highlight", "neutral", "catch"] as const;
const itemSchema = z.object({ name: z.string(), meta: z.string(), metric: z.string(), source: z.number() });
const outputSchema = z.object({
  kindLabel: z.string(),
  topPick: itemSchema.extend({ edgeLabel: z.string(), edgeTone: z.enum(TONE), reason: z.string() }),
  rows: z.array(itemSchema.extend({ roleLabel: z.string(), roleTone: z.enum(TONE) })),
  limit: z.string(),
  chips: z.array(z.string()),
});
type Output = z.infer<typeof outputSchema>;
const JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kindLabel", "topPick", "rows", "limit", "chips"],
  properties: {
    kindLabel: { type: "string" },
    topPick: {
      type: "object", additionalProperties: false,
      required: ["name", "meta", "metric", "source", "edgeLabel", "edgeTone", "reason"],
      properties: {
        name: { type: "string" }, meta: { type: "string" }, metric: { type: "string" }, source: { type: "number" },
        edgeLabel: { type: "string" }, edgeTone: { type: "string", enum: TONE as unknown as string[] }, reason: { type: "string" },
      },
    },
    rows: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["name", "meta", "metric", "source", "roleLabel", "roleTone"],
      properties: {
        name: { type: "string" }, meta: { type: "string" }, metric: { type: "string" }, source: { type: "number" },
        roleLabel: { type: "string" }, roleTone: { type: "string", enum: TONE as unknown as string[] },
      },
    } }, // no minItems/maxItems: the API rejects them; validated with zod after parsing
    limit: { type: "string" },
    chips: { type: "array", items: { type: "string" } },
  },
} as const;

type Source = { title: string; url: string; snippet: string };

/** So a later chat can recall this suggestion ("which product did you suggest for strawberry skin") -- optional and never required: a
 * live eval or any other caller with no conversation to save against simply omits it, the same convention research.ts's own
 * RememberResearch already established. */
export type RememberSuggestion = (state: { subject: string; topPick: string; alternatives: string[]; options: Array<{ name: string; metric: string; meta: string }> }) => Promise<void>;

function actionLabelFor(url: string) {
  try { return `View at ${new URL(url).hostname.replace(/^www\./, "")}`; } catch { return "View source"; }
}

/** Every name, metric and reason here is grounded in a numbered source the model actually cites -- the same "only trust what the
 * evidence shows" discipline research.ts and claim-grounding.ts already apply, never a fabricated price or rating. A source the model
 * cites out of range just loses its own link/attribution rather than showing a wrong one. */
function buildCard(subject: string, output: Output, sources: Source[]): SuggestionCardPayload {
  const sourceUrl = (n: number) => Number.isInteger(n) && n >= 1 && n <= sources.length ? sources[n - 1].url : "";
  const topUrl = sourceUrl(output.topPick.source);
  return {
    kind: "suggestion",
    kindLabel: plain(output.kindLabel, 100) || plain(subject, 100),
    freshness: "Just now",
    topPick: {
      name: plain(output.topPick.name, 80), meta: plain(output.topPick.meta, 120), metric: plain(output.topPick.metric, 40),
      edgeTag: output.topPick.edgeLabel.trim() ? { label: plain(output.topPick.edgeLabel, 40), tone: output.topPick.edgeTone } : null,
      reason: plain(output.topPick.reason, 200), actionLabel: topUrl ? actionLabelFor(topUrl) : "", actionUrl: topUrl,
    },
    rows: output.rows.slice(0, 3).map((row) => ({
      name: plain(row.name, 80), meta: plain(row.meta, 120), metric: plain(row.metric, 40),
      roleTag: { label: plain(row.roleLabel, 40), tone: row.roleTone },
    })),
    limit: plain(output.limit, 200),
    sources: [...new Set([output.topPick.source, ...output.rows.map((row) => row.source)])]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length)
      .map((n) => ({ label: plain(new URL(sources[n - 1].url).hostname.replace(/^www\./, ""), 60), url: sources[n - 1].url })),
    chips: output.chips.filter((chip) => chip.trim()).map((chip) => plain(chip, 40)).slice(0, 4),
  };
}

function renderSuggestionText(card: SuggestionCardPayload): string {
  const lines = [`### ${card.kindLabel}`, `**${card.topPick.name}** — ${card.topPick.metric}`];
  if (card.topPick.reason) lines.push(card.topPick.reason);
  return lines.join("\n\n");
}

/**
 * A real, structured recommendation (R47) for an ordinary "find me some options" request -- too small for research mode's own bigger
 * per-option pipeline (R32/v33's own "quick pick" line, extended here to "quick shopping list"), but still real evidence, not a plain
 * prose paragraph: one search, one extraction call, grounded in real cited sources throughout. Falls back to the existing Tavily-backed
 * general search whenever there's nothing to extract from, the same fallback stocks/weather/sports/fares already use.
 */
export async function answerSuggestions(query: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>, memoryContext = "", today?: string, remember?: RememberSuggestion): Promise<string> {
  const fallback = () => answerPublicSearch(query, undefined, memoryContext, today);
  try {
    const research = await searchPublicWeb(query, { depth: "advanced", maxResults: 8, snippetLength: 1200 });
    const sources = research.sources.slice(0, 8);
    if (!sources.length) return fallback();

    const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\nEvidence: ${source.snippet}`).join("\n\n");
    const response = await complete({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      temperature: 0,
      system: `You read real search evidence for "${query}" and pick a real top recommendation plus up to 3 real alternatives -- only from the evidence given, never inventing a name, price, rating or spec. kindLabel: what this answer is, in plain sentence case ("Men's fleece jackets, size M"). topPick: the single best real option from the evidence, with its own name, meta (where it's from, one attribute, a rating if given), metric (its own key number: price, distance, runtime -- whatever actually answers the request), edgeLabel (one short reason it's the pick: "44-50% off", "Cheapest solid", "" if nothing stands out), edgeTone ("good" for a real discount/deal, "highlight" for a standout attribute, "neutral" otherwise), reason (one line, why this one), source (the evidence number it came from). rows: 1 to 3 other real options, each with name/meta/metric/source plus roleLabel (its own one-word-or-two role: "Cheapest", "Premium", "Solid budget") and roleTone ("good" for another strong buy, "highlight" for a standout on one dimension like price or speed, "neutral" for a plain alternative, "catch" only when there's a real downside worth flagging, like "Thin, can pill" for a cheap option). limit: one short honest line on what this answer can't cover (stock/availability, coupons, regional pricing -- whatever's actually true here). chips: 2 to 4 short phrases (3-5 words) for realistic follow-ups to THIS specific answer (a narrower filter, a deeper comparison, an action, or a broader option) -- never generic, always grounded in what was actually found. Return JSON only.`,
      messages: [{ role: "user", content: evidence }],
      output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") return fallback();
    const output = outputSchema.parse(JSON.parse(block.text));
    if (!output.topPick.name.trim()) return fallback();
    const card = buildCard(query, output, sources);
    if (remember) await remember({ subject: card.kindLabel, topPick: card.topPick.name, alternatives: card.rows.map((row) => row.name), options: [card.topPick, ...card.rows].map((option) => ({ name: option.name, metric: option.metric, meta: option.meta })) }).catch(() => undefined);
    return embedCard(renderSuggestionText(card), card);
  } catch (error) {
    reportFailure("suggestions_failed", error, { query });
    return fallback();
  }
}
