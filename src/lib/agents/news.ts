import { getRequestContext, remainingRequestMs } from "@/lib/runtime/request-context";
import { QueryBudgetUnavailableError } from "@/lib/runtime/query-budget";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { embedCard, type DigestCardPayload } from "@/lib/chat/card-payload";
import { fitSentences } from "./cricket-news";
import { plain } from "./search-answer";
import { answerPublicSearch } from "./general";
import { reportFailure } from "@/lib/observability/report";

const outputSchema = z.object({
  subject: z.string(),
  kindLabel: z.string(),
  summary: z.string(),
  stories: z.array(z.object({ source: z.number(), headline: z.string(), aboutSubject: z.boolean() })),
  chips: z.array(z.string()),
});
type Output = z.infer<typeof outputSchema>;
const JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["subject", "kindLabel", "summary", "stories", "chips"],
  properties: {
    subject: { type: "string" }, kindLabel: { type: "string" }, summary: { type: "string" },
    stories: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "headline", "aboutSubject"], properties: { source: { type: "number" }, headline: { type: "string" }, aboutSubject: { type: "boolean" } } } },
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
/** The stories that are really about what was asked, each tied to the evidence it came from -- a source outside the evidence, a repeat, or a
 * story the model itself says is about something else never gets through. */
export function keepRelevantStories(output: Output, sources: Source[], now: Date) {
  const used = new Set<number>();
  const stories = output.stories.flatMap((story) => {
    if (!story.aboutSubject || !Number.isInteger(story.source) || story.source < 1 || story.source > sources.length || used.has(story.source) || !story.headline.trim()) return [];
    used.add(story.source);
    const source = sources[story.source - 1];
    return [{ headline: plain(story.headline, 100), meta: [host(source.url), storyAge(source.published, now)].filter(Boolean).join(" · "), url: source.url, source: story.source }];
  }).slice(0, 5);
  return stories;
}

/**
 * News on any topic other than cricket ("any football news", "tech news", "what's happening with Nvidia"): a one or two sentence summary
 * of the top stories, then a "Top stories" list where every headline links to the real article it came from, with its source and age.
 * Found live, R47: "Cricket Mobile Network the company" got a confident digest of a war story, because the last three days held no news
 * about that company, the search returned whatever loosely matched, and nothing asked whether those stories were about the subject. So:
 * the search starts at three days and widens to two weeks when too little of it is actually about the subject, the model must say per story
 * whether it is about what was asked (a shared word isn't enough), only those are shown, and when nothing is, this falls back to the
 * plain search rather than dressing unrelated news up as an answer.
 */
export async function answerNews(query: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>, memoryContext = "", today?: string, now: Date = new Date()): Promise<string> {
  const hasTimeForAnotherPass = () => !getRequestContext()?.signal?.aborted && remainingRequestMs(60_000) >= 30_000;
  const fallback = () => {
    if (!hasTimeForAnotherPass()) throw new QueryBudgetUnavailableError("time");
    return answerPublicSearch(query, undefined, memoryContext, today);
  };
  try {
    const attempt = async (days: number) => {
      const research = await searchPublicWeb(query, { topic: "news", days, depth: "basic", maxResults: 7, snippetLength: 700 });
      const sources: Source[] = research.sources.slice(0, 7);
      if (!sources.length) return null;
      const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}${source.published ? ` (published ${source.published})` : ""}\nEvidence: ${source.snippet}`).join("\n\n");
      const response = await complete({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1800,
        temperature: 0,
        system: `You turn recent news evidence into a short digest for someone asking "${query}". Today is ${today ?? now.toISOString().slice(0, 10)}. subject: what the person is asking about, in a few words, taken from their question and never from the evidence. The evidence was found by a keyword search and is often about something else that merely shares a word -- a carrier named Cricket is not the sport, a mobile outage elsewhere is not news about a mobile company. stories: up to 5 distinct stories, most recent and notable first; each has source (the evidence number, never reused), headline (a plain one-line headline under 90 characters saying what happened, from that evidence; not the site name, not clickbait), and aboutSubject: true ONLY when the story is actually about the subject, false for anything else (list it as false rather than leaving it out). Skip evidence that isn't recent news at all (a live-scores page, a section front, a review or forum page). kindLabel: "<subject> news" in plain sentence case ("Tech news", "Cricket Wireless news"). summary: one or two short plain sentences, under 200 characters in all, of the most notable thing or two from the aboutSubject stories only -- only what the evidence states, never a name, number or claim that isn't written there; empty when no story is about the subject. chips: 2 or 3 short phrases (3-5 words) for realistic follow-ups grounded in those stories. Return JSON only.`,
        messages: [{ role: "user", content: `News evidence:\n${evidence}` }],
        output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
      });
      // A token-limited response is not completed JSON, even if the HTTP call succeeded.
      if (response.stop_reason === "max_tokens") throw new Error("NEWS_OUTPUT_TRUNCATED");
      const block = response.content.find((item) => item.type === "text");
      if (!block || block.type !== "text") return null;
      const output = outputSchema.parse(JSON.parse(block.text));
      return { output, sources, stories: keepRelevantStories(output, sources, now) };
    };

    let result = await attempt(3);
    if ((!result || result.stories.length < 2) && hasTimeForAnotherPass()) {
      try {
        const wider = await attempt(14);
        if (wider && wider.stories.length > (result?.stories.length ?? 0)) result = wider;
      } catch (error) {
        // An optional expansion must not discard an already grounded story.
        if (!result?.stories.length || getRequestContext()?.signal?.aborted) throw error;
        reportFailure("news_expansion_failed", error);
      }
    }
    if (!result || !result.stories.length) return fallback();
    const { output, sources, stories } = result;

    const card: DigestCardPayload = {
      kind: "digest",
      kindLabel: plain(output.kindLabel, 60) || "News",
      freshness: `As of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles" }).format(now)}`,
      summary: fitSentences(output.summary, 220),
      sections: [{ kind: "stories", title: "Top stories", stories: stories.map(({ headline, meta, url }) => ({ headline, meta, url })) }],
      sources: stories.map((story) => ({ label: plain(host(story.url), 60), url: story.url })).filter((source) => source.label).slice(0, 4),
      chips: output.chips.filter((chip) => chip.trim()).map((chip) => ({ label: plain(chip, 40), text: plain(chip, 40) })).slice(0, 3),
    };
    return embedCard(renderNewsText(card), card);
  } catch (error) {
    reportFailure("news_failed", error, { query });
    if (getRequestContext()?.signal?.aborted || error instanceof QueryBudgetUnavailableError || (error instanceof Error && error.message === "NEWS_OUTPUT_TRUNCATED")) throw error;
    return fallback();
  }
}
