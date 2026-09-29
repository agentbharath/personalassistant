import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { configuredModel, prepareAgentStage } from "@/lib/runtime/query-budget";
import { supportsTemperature } from "@/lib/runtime/model-runtime";
import { extendRequestBudget } from "@/lib/runtime/request-context";
import { DAYLARK_PERSONA } from "@/lib/model/persona";
import { plain } from "./search-answer";
import { reportFailure } from "@/lib/observability/report";

/** Same shape as `callClaude`'s own (operation, params) -- the same deps-injection R20.5/R32 already uses for the time interpreter and the
 * trip planner, so this can be verified live without forcing it through this session's per-call SpendMeter framework blind. */
export type ResearchDeps = { complete: (operation: string, params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };

/** A big comparison question does several parallel searches and up to two model calls (one at the "high" tier) -- comfortably more time
 * and cost than the default per-request budget, which exists to keep an ordinary quick lookup cheap, not to cap a request that genuinely
 * needs real per-option research. Same budget the trip planner uses, for the same reason. */
const RESEARCH_BUDGET = { totalMs: 100_000, costLimitUsd: 0.6 } as const;

/**
 * A real, code-driven comparison pipeline (R47), for requests too big for a quick lookup: "compare these 4 air purifiers", "is a Roth or
 * traditional 401k better for me". As distinct from a quick pick between two things ("should I get an iPad or a Kindle"), which
 * `agents/general.ts` already handles well in one search-and-summarize call (R32/v33) -- only the router's own judgment of "this is a
 * genuinely big comparison, not a quick pick" reaches this path at all (see router.ts's "research" operation). Modeled directly on
 * trip-planner.ts's own pipeline: research several real queries, extract named, sourced candidate facts (never letting the composer read
 * raw snippets itself), compose one structured, decisive comparison with a stronger model, check its shape deterministically, repair once.
 * Bump RESEARCH_VERSION on any change to a prompt or schema below.
 */
// v2: found live, the composer literally wrote "fact 12"/"fact 3" inline in reasoning prose instead of stating the number or claim
// itself -- composerSystem now explicitly forbids writing the word "fact" or a bare source number in recommendation/reasoning.
export const RESEARCH_VERSION = "research-v2";

type Source = { title: string; url: string; snippet: string };

/** Per named option when the request names them ("Coway vs Levoit vs Winix"); one broader set of exploratory queries when it doesn't
 * ("what's the best budget laptop for programming under $800") -- options are then discovered from the evidence itself, same as the trip
 * planner's own candidates are never pre-named by the person either. Best-effort per query: one failed query never sinks the whole thing. */
async function researchSubject(subject: string, options: string[]): Promise<Source[]> {
  const queries = options.length
    ? options.map((option) => `${option} review, specs and price`)
    : [`best ${subject}`, `${subject} comparison`, `${subject} expert review`, `${subject} buying guide`];
  const settled = await Promise.allSettled(queries.map((query) => searchPublicWeb(query, { depth: "advanced", maxResults: 6, snippetLength: 1200 })));
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const source of result.value.sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources.slice(0, 24);
}

const factSchema = z.object({ option: z.string(), category: z.enum(["price", "spec", "pro", "con", "verdict"]), detail: z.string(), source: z.number() });
const factsSchema = z.object({ facts: z.array(factSchema) });
type Fact = z.infer<typeof factSchema>;
const FACTS_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["facts"],
  properties: { facts: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["option", "category", "detail", "source"],
    properties: {
      option: { type: "string" }, category: { type: "string", enum: ["price", "spec", "pro", "con", "verdict"] },
      detail: { type: "string" }, source: { type: "number" },
    },
  } } },
} as const;

/** One model call turns raw evidence into named, sourced facts the composer can build a comparison from -- never letting the composer
 * read the raw evidence itself, the same reasoning the trip planner's own candidate extraction already applies. */
async function extractFacts(subject: string, options: string[], sources: Source[], deps: ResearchDeps): Promise<Fact[]> {
  if (!sources.length) return [];
  const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\nEvidence: ${source.snippet}`).join("\n\n");
  prepareAgentStage(["general"], "fast");
  const extractionModel = configuredModel("fast");
  try {
    const response = await deps.complete("research_fact_extraction", {
      model: extractionModel,
      max_tokens: 2200,
      ...(supportsTemperature(extractionModel) ? { temperature: 0 } : {}),
      system: `You read search evidence for a comparison of ${subject}${options.length ? ` among: ${options.join(", ")}` : ""} and list real, sourced facts worth comparing on: prices, specs, expert opinions, and named pros/cons. Only from the evidence given -- never invent a number, spec or claim the evidence doesn't state. option: the specific named item this fact is about, in the person's own words or the evidence's own name for it -- never a fact with no specific option attached. category: price, spec, pro, con or verdict (an expert's overall recommendation or ranking). detail: the one specific fact itself, plain and un-marketed ("$249 MSRP", "covers up to 500 sq ft", "loud on the highest setting"). source: the evidence number it came from. List up to 24, the strongest and most comparison-relevant ones first; skip generic praise with no actual fact in it ("customers love it"). Return JSON only.`,
      messages: [{ role: "user", content: evidence }],
      output_config: { format: { type: "json_schema", schema: FACTS_JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") throw new Error("RESEARCH_FACTS_MISSING");
    return factsSchema.parse(JSON.parse(block.text)).facts.slice(0, 24);
  } catch (error) {
    reportFailure("research_extraction_failed", error, { version: RESEARCH_VERSION });
    return [];
  }
}

const comparisonSchema = z.object({
  recommendation: z.string(), reasoning: z.string(),
  options: z.array(z.object({ name: z.string(), facts: z.array(z.object({ detail: z.string(), source: z.number() })) })),
  caveat: z.string(),
});
export type Comparison = z.infer<typeof comparisonSchema>;
const COMPARISON_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["recommendation", "reasoning", "options", "caveat"],
  properties: {
    recommendation: { type: "string" }, reasoning: { type: "string" },
    options: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["name", "facts"],
      properties: { name: { type: "string" }, facts: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["detail", "source"],
        properties: { detail: { type: "string" }, source: { type: "number" } },
      } } },
    } },
    caveat: { type: "string" },
  },
} as const;

function composerSystem(subject: string, sourceCount: number) {
  return `${DAYLARK_PERSONA}

You compose one decisive comparison from real facts already extracted from search evidence about ${subject} -- you do not invent prices, specs or claims beyond what a fact's detail says.

recommendation: one direct sentence naming the actual pick ("Go with the Coway AP-1512HH"), never a hedge ("it depends") or a tie -- if the evidence is genuinely split, still name the one that best fits what was actually asked, and say why in reasoning.
reasoning: 2 to 4 sentences, the actual deciding factors, each stating a real number or claim (a price, a spec, an expert's own verdict) plainly in prose, never generic praise. Never write the word "fact" or a bare source number in recommendation or reasoning -- state the number or claim itself ("2,400W solar input"), not a reference to where it came from; a reader-facing citation only ever belongs next to an option's own facts below, never inline in prose.
options: one entry per option actually compared (every option named in the request, plus any others the evidence surfaced worth mentioning), each with 2 to 5 of its own most relevant facts, in the person's or evidence's own name for it, and source (the fact's own source number -- cite only numbers 1 to ${sourceCount}, never invent one).
caveat: one short line only when something matters (prices vary by retailer, a spec wasn't confirmed across all sources), else "".

Voice: commit, specific details only, no filler adjectives (stunning, magical, must-see, hidden gem, world-class, unforgettable, iconic, perfect, amazing, incredible), no opener like "Here's a comparison". Return JSON only.`;
}

async function composeComparison(subject: string, facts: Fact[], sourceCount: number, deps: ResearchDeps, repairNote?: string): Promise<Comparison> {
  const evidence = facts.map((fact, index) => `${index + 1}. [${fact.option}] (${fact.category}) ${fact.detail} [source ${fact.source}]`).join("\n");
  prepareAgentStage(["general"], "high");
  const compositionModel = configuredModel("high");
  const response = await deps.complete("research_comparison_composition", {
    model: compositionModel,
    max_tokens: 1800,
    ...(supportsTemperature(compositionModel) ? { temperature: 0 } : {}),
    system: composerSystem(subject, sourceCount),
    messages: [{ role: "user", content: `Facts:\n${evidence}${repairNote ? `\n\nYour previous attempt had problems -- fix them: ${repairNote}` : ""}` }],
    output_config: { format: { type: "json_schema", schema: COMPARISON_JSON_SCHEMA } },
  });
  const block = response.content.find((item) => item.type === "text");
  if (!block || block.type !== "text") throw new Error("RESEARCH_COMPARISON_MISSING");
  return comparisonSchema.parse(JSON.parse(block.text));
}

/** Deterministic, never a second guess at what the comparison should say (R20.6, same reasoning as critiqueItinerary): only checks the
 * shape it promised -- at least two options actually compared, every option with a real fact, every citation a real source. */
export function critiqueComparison(comparison: Comparison, sourceCount: number): string[] {
  const issues: string[] = [];
  if (comparison.options.length < 2) issues.push(`"options" must compare at least 2 things; it had ${comparison.options.length}.`);
  for (const option of comparison.options) {
    if (!option.facts.length) issues.push(`"${option.name}" has no facts; every option needs at least one.`);
    for (const fact of option.facts) {
      if (!Number.isInteger(fact.source) || fact.source < 1 || fact.source > sourceCount) issues.push(`"${option.name}"'s fact "${fact.detail}" cites source ${fact.source}, which is not one of the 1-${sourceCount} real sources given.`);
    }
  }
  return issues;
}

function renderComparison(comparison: Comparison, subject: string, sources: Source[]): string {
  // 400/900, not the usual 160/500: recommendation is "one direct sentence" but often a compound one with real numbers in it, and
  // reasoning is 2-4 full sentences -- both routinely ran past a tighter cap and got cut off mid-word (found live: a budget-laptop
  // recommendation truncated to "...typical budget m", an air-purifier reasoning cut to "...the Coway Airmega 400 is").
  const lines: string[] = [`### ${plain(subject, 100)}`, `**${plain(comparison.recommendation, 400)}**`, plain(comparison.reasoning, 900)];
  for (const option of comparison.options) {
    lines.push(`#### ${plain(option.name, 80)}`);
    const facts = option.facts.map((fact) => {
      const detail = plain(fact.detail, 160);
      if (!detail) return "";
      const cite = Number.isInteger(fact.source) && fact.source >= 1 && fact.source <= sources.length ? ` [${fact.source}]` : "";
      return `- ${detail}${cite}`;
    }).filter(Boolean);
    lines.push(facts.join("\n"));
  }
  if (comparison.caveat.trim()) lines.push(`*${plain(comparison.caveat, 200)}*`);
  if (sources.length) lines.push(`### Sources\n${sources.map((source, index) => `- **${index + 1}** · [${plain(source.title, 120)}](${source.url})`).join("\n")}`);
  return lines.filter(Boolean).join("\n\n");
}

/** The whole pipeline: research, extract, compose, check, repair once, render. Never the single-shot search-and-summarize path
 * (`agents/general.ts`) for a request this big -- the same distinction R32 already draws for trips. `deps` is required, never defaulted
 * to the real `callClaude`, so a live eval can inject a spend-metered raw call the same way the trip planner's own does. */
export async function runResearch(subject: string, options: string[], deps: ResearchDeps): Promise<string> {
  extendRequestBudget(RESEARCH_BUDGET.totalMs, RESEARCH_BUDGET.costLimitUsd);
  const sources = await researchSubject(subject, options);
  if (!sources.length) return `I couldn't find reliable current information to compare ${subject}. Try again in a bit, or ask about one option at a time.`;

  const facts = await extractFacts(subject, options, sources, deps);
  if (!facts.length) return `I found sources on ${subject} but nothing specific enough to compare. Try naming the specific options you want compared.`;

  let comparison: Comparison;
  try {
    comparison = await composeComparison(subject, facts, sources.length, deps);
  } catch (error) {
    reportFailure("research_composition_failed", error, { version: RESEARCH_VERSION });
    try {
      comparison = await composeComparison(subject, facts, sources.length, deps, "Your previous response could not be read as valid JSON -- it may have run out of room. Keep every field valid, and keep the whole response within the token limit by using fewer or shorter facts if needed; never truncate mid-field.");
    } catch (retryError) {
      reportFailure("research_composition_failed_twice", retryError, { version: RESEARCH_VERSION });
      return `I ran into a problem putting that comparison together. Please try again, or narrow what you're comparing.`;
    }
  }
  const issues = critiqueComparison(comparison, sources.length);
  if (issues.length) {
    try {
      comparison = await composeComparison(subject, facts, sources.length, deps, issues.join(" "));
    } catch (error) {
      reportFailure("research_repair_failed", error, { version: RESEARCH_VERSION });
    }
    const remaining = critiqueComparison(comparison, sources.length);
    if (remaining.length) reportFailure("research_unrepaired", new Error(remaining.join(" ")), { version: RESEARCH_VERSION });
  }
  return renderComparison(comparison, subject, sources);
}
