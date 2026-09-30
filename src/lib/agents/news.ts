import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { embedCard, type DigestCardPayload } from "@/lib/chat/card-payload";
import { fitSentences } from "./cricket-news";
import { plain } from "./search-answer";
import { answerPublicSearch } from "./general";
import { reportFailure } from "@/lib/observability/report";

const outputSchema = z.object({
  kindLabel: z.string(),
  summary: z.string(),
  stories: z.array(z.object({ source: z.number(), headline: z.string() })),
  chips: z.array(z.string()),
});
const JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["kindLabel", "summary", "stories", "chips"],
  properties: {
    kindLabel: { type: "string" }, summary: { type: "string" },
    stories: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "headline"], properties: { source: { type: "number" }, headline: { type: "string" } } } },
    chips: { type: "array", items: { type: "string" } },
  },
} as const;

type Source = { title: string; url: string; snippet: string; published?: string };

/** "2h ago" within a day, "Sep 29" after; empty when the date is missing or unreadable -- computed here, never by the model. */
export function storyAge(published: string | undefined, now: Date): string {
  const time = published ? Date.parse(published) : NaN;
  if (!Number.isFinite(time) || time > now.getTime() + 3_600_000) return "";
  const hours = Math.floor((now.getTime() - time) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

function renderNewsText(card: DigestCardPayload): string {
  const stories = card.sections.flatMap((section) => section.kind === "stories" ? section.stories.map((story) => `- ${story.headline}`) : []);
  return [`### ${card.kindLabel}`, card.summary, ...stories].filter(Boolean).join("\n\n");
}

/**
 * News on any topic other than cricket ("any football news", "tech news", "what's happening with Nvidia"): a one or two sentence summary
 * of the top stories, then a "Top stories" list where every headline links to the real article it came from, with its source and age.
 * One recent-news search, one extraction call grounded in that evidence -- the same discipline as every other card here. Falls back to the
 * plain search when the news search has nothing usable.
 */
export async function answerNews(query: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>, memoryContext = "", today?: string, now: Date = new Date()): Promise<string> {
  const fallback = () => answerPublicSearch(query, undefined, memoryContext, today);
  try {
    const research = await searchPublicWeb(query, { topic: "news", days: 3, depth: "basic", maxResults: 7, snippetLength: 700 });
    const sources: Source[] = research.sources.slice(0, 7);
    if (!sources.length) return fallback();

    const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}${source.published ? ` (published ${source.published})` : ""}\nEvidence: ${source.snippet}`).join("\n\n");
    const response = await complete({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      temperature: 0,
      system: `You turn recent news evidence into a short digest for someone asking "${query}". Today is ${today ?? now.toISOString().slice(0, 10)}. kindLabel: what this is, in plain sentence case ("Tech news", "NFL news"). summary: one or two short plain sentences, under 200 characters in all, of the most notable thing or two -- only what the evidence states, never a name, number or claim that isn't written there. stories: up to 5 distinct stories, most recent and notable first; each source = the evidence number it comes from (never reuse one), headline = a plain one-line headline under 90 characters saying what happened, taken from that evidence (not the site name, not clickbait). Skip evidence that isn't recent news (a live-scores page, a section front, an old article). chips: 2 or 3 short phrases (3-5 words) for realistic follow-ups grounded in these stories. Return JSON only.`,
      messages: [{ role: "user", content: `News evidence:\n${evidence}` }],
      output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
    });
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") return fallback();
    const output = outputSchema.parse(JSON.parse(block.text));

    const used = new Set<number>();
    const stories = output.stories.flatMap((story) => {
      if (!Number.isInteger(story.source) || story.source < 1 || story.source > sources.length || used.has(story.source) || !story.headline.trim()) return [];
      used.add(story.source);
      const source = sources[story.source - 1];
      return [{ headline: plain(story.headline, 100), meta: [host(source.url), storyAge(source.published, now)].filter(Boolean).join(" · "), url: source.url }];
    }).slice(0, 5);
    if (!stories.length) return fallback();

    const card: DigestCardPayload = {
      kind: "digest",
      kindLabel: plain(output.kindLabel, 60) || "News",
      freshness: `As of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles" }).format(now)}`,
      summary: fitSentences(output.summary, 220),
      sections: [{ kind: "stories", title: "Top stories", stories }],
      sources: [...used].map((n) => ({ label: plain(host(sources[n - 1].url), 60), url: sources[n - 1].url })).filter((source) => source.label).slice(0, 4),
      chips: output.chips.filter((chip) => chip.trim()).map((chip) => ({ label: plain(chip, 40), text: plain(chip, 40) })).slice(0, 3),
    };
    return embedCard(renderNewsText(card), card);
  } catch (error) {
    reportFailure("news_failed", error, { query });
    return fallback();
  }
}
