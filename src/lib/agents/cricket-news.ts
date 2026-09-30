import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { fetchCricketRoundup, type CricketRoundupEvent } from "@/lib/tools/sports/espn-cricket";
import { embedCard, type DigestCardPayload, type DigestSection, type ScoresEvent } from "@/lib/chat/card-payload";
import { scoreTeam, shortDate, spellOutResult } from "./sports";
import { plain } from "./search-answer";
import { answerPublicSearch } from "./general";
import { reportFailure } from "@/lib/observability/report";

const outputSchema = z.object({ summary: z.string(), sources: z.array(z.number()) });
const JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "sources"],
  properties: { summary: { type: "string" }, sources: { type: "array", items: { type: "number" } } },
} as const;

type Source = { title: string; url: string; snippet: string; published?: string };
type Sides = ScoresEvent["sides"];
const sidesOf = (event: CricketRoundupEvent, leadWinner: boolean) => event.sides.map((side) => scoreTeam(side.name, side.score, leadWinner && side.winner)) as Sides;
/** Keeps whole sentences within `max` characters (the model sometimes runs past the length it was given); never ends mid-word. */
export function fitSentences(text: string, max: number): string {
  const clean = plain(text, 2000);
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
  let kept = "";
  for (const sentence of sentences) { if ((kept + sentence).trim().length > max) break; kept = `${kept}${sentence}`; }
  if (kept.trim()) return kept.trim();
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;:\s]+$/, "")}…`;
}
const matchup = (event: CricketRoundupEvent) => `${event.sides[0].name} vs ${event.sides[1].name}`;

/** The digest's sections, every value straight from ESPN's own feed. Full internationals only when any exist (the same reasoning as the
 * roundup card: domestic and A-team matches otherwise crowd out the ones anyone asks about). Live matches first, then what finished with a
 * result, then what finished with none (shown as a list, never as a score block), then what's still to come. */
export function buildDigestSections(events: CricketRoundupEvent[]): DigestSection[] {
  const internationals = events.filter((event) => event.international);
  const pool = internationals.length ? internationals : events;
  const byDate = (a: CricketRoundupEvent, b: CricketRoundupEvent) => a.date.localeCompare(b.date);
  const live = pool.filter((event) => event.status === "in_progress").sort(byDate);
  const finals = pool.filter((event) => event.status === "final").sort((a, b) => b.date.localeCompare(a.date));
  const decided = finals.filter((event) => event.sides.some((side) => side.winner)).slice(0, 2);
  const abandoned = finals.filter((event) => !event.sides.some((side) => side.winner)).slice(0, 3);
  const upcoming = pool.filter((event) => event.status === "scheduled").sort(byDate).slice(0, 2);
  const label = (event: CricketRoundupEvent) => [event.stage, event.venue, shortDate(event.date)].filter(Boolean).join(" · ");

  const sections: DigestSection[] = [];
  if (live.length) sections.push({ kind: "events", title: "Live now", events: live.map((event) => ({ label: label(event), tag: { label: "Live", tone: "live" as const }, sides: sidesOf(event, false), outcome: "" })) });
  if (decided.length) sections.push({ kind: "events", title: "Result", events: decided.map((event) => ({ label: label(event), tag: { label: spellOutResult(event.summary) || "Final", tone: "good" as const }, sides: sidesOf(event, true), outcome: "" })) });
  if (abandoned.length) sections.push({ kind: "list", title: "Abandoned", rows: abandoned.map((event) => ({ name: matchup(event), meta: [event.series, event.stage, shortDate(event.date)].filter(Boolean).join(" · "), tag: { label: /rain/i.test(event.summary) ? "Rain" : "No result", tone: "catch" as const } })) });
  if (upcoming.length) sections.push({ kind: "tiles", title: "Coming up", tiles: upcoming.map((event, index) => ({ month: shortDate(event.date).split(" ")[0].toUpperCase(), day: shortDate(event.date).split(" ")[1], name: matchup(event), meta: [event.stage, event.venue, event.startsAt].filter(Boolean).join(" · "), next: index === 0 })) });
  return sections;
}

/** Follow-ups that come straight from what the card shows, never generic: a live score for a match that's on, an act chip for the next
 * one that isn't, and the broader list. */
function buildChips(events: CricketRoundupEvent[]): DigestCardPayload["chips"] {
  const internationals = events.filter((event) => event.international);
  const pool = internationals.length ? internationals : events;
  const chips: DigestCardPayload["chips"] = [];
  const live = pool.find((event) => event.status === "in_progress");
  if (live) chips.push({ label: `Live score, ${live.stage}`, text: `What's the live ${live.sides[0].name} vs ${live.sides[1].name} cricket score` });
  const next = pool.filter((event) => event.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date))[0];
  if (next) chips.push({ label: `Add ${next.stage} to calendar`, act: true, text: `Add ${matchup(next)}, ${next.stage}${next.venue ? ` at ${next.venue}` : ""} on ${shortDate(next.date)} to my calendar` });
  chips.push({ label: "Other cricket today", text: "Any cricket scores today?" });
  return chips;
}

function asOf(now: Date) {
  const text = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles" }).format(now);
  return `As of ${text}`;
}

function renderDigestText(card: DigestCardPayload): string {
  const lines = [`### ${card.kindLabel}`];
  if (card.summary) lines.push(card.summary);
  for (const section of card.sections) {
    if (section.kind === "events") lines.push(`**${section.title}:** ${section.events.map((event) => `${event.sides.map((side) => `${side.name} ${side.score}`.trim()).join(" v ")} (${event.tag.label})`).join("; ")}`);
    else if (section.kind === "list") lines.push(`**${section.title}:** ${section.rows.map((row) => `${row.name} (${row.tag.label})`).join("; ")}`);
    else lines.push(`**${section.title}:** ${section.tiles.map((tile) => `${tile.name}, ${tile.month} ${tile.day}`).join("; ")}`);
  }
  return lines.join("\n\n");
}

/**
 * A cricket news digest: a line or two of real news on top (from a recent-news search, every claim from its evidence), then sections built
 * from ESPN's own match data. The news line may also lean on the verified match list, but never invents a score, date or name -- and is
 * simply left out, never padded, when the search has nothing recent. Falls back to the plain search when there is neither news nor any
 * match to show.
 */
export async function answerCricketNews(query: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>, memoryContext = "", today?: string, now: Date = new Date()): Promise<string> {
  const fallback = () => answerPublicSearch(query, undefined, memoryContext, today);
  try {
    const matchesResult = await Promise.allSettled([fetchCricketRoundup(now, { backHours: 48, forwardHours: 60 })]).then(([result]) => result);
    const events = matchesResult.status === "fulfilled" ? matchesResult.value ?? [] : [];
    const sections = buildDigestSections(events);

    // Two searches, merged: the broad one, and one about the match the card leads with -- found live, 2026-09-30: the broad query alone
    // returned a mixed bag and the real stories about that day's result (a double century, a record total) never made the evidence.
    const lead = [...events].filter((event) => event.international !== false).sort((a, b) => (a.status === "in_progress" ? -1 : 0) - (b.status === "in_progress" ? -1 : 0) || b.date.localeCompare(a.date)).find((event) => event.status !== "scheduled");
    const searches = await Promise.allSettled([
      searchPublicWeb(`cricket news ${query}`.slice(0, 300), { topic: "news", days: 3, depth: "basic", maxResults: 5, snippetLength: 600 }),
      ...(lead ? [searchPublicWeb(`${lead.sides[0].name} vs ${lead.sides[1].name} cricket ${lead.stage}`, { topic: "news", days: 3, depth: "basic", maxResults: 5, snippetLength: 600 })] : []),
    ]);
    const seen = new Set<string>();
    const sources: Source[] = searches.flatMap((result) => result.status === "fulfilled" ? result.value.sources : [])
      .filter((source) => !seen.has(source.url) && seen.add(source.url)).slice(0, 8);

    let summary = "";
    let cited: number[] = [];
    if (sources.length) {
      try {
        const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}${source.published ? ` (published ${source.published})` : ""}\nEvidence: ${source.snippet}`).join("\n\n");
        const response = await complete({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          temperature: 0,
          system: `You write the top line of a cricket news digest for someone asking "${query}". Today is ${today ?? now.toISOString().slice(0, 10)}. summary: one or two short, plain sentences, under 200 characters in all, of the most notable recent stories in the news evidence -- a record, an individual feat, a reason a match was affected, a storyline or what is at stake -- stating only what the evidence says, never a score, date, name or reason that isn't written there. Match scores and results are shown separately in cards next to this line, so a bare \"X beat Y\" is not a story: lead with what makes it notable (\"Shubman Gill's unbeaten 223 powered India's record chase\"). Prefer what happened in the last day or two. If nothing recent and notable is in the evidence, return an empty summary rather than padding. sources: the evidence numbers the summary relies on. Return JSON only.`,
          messages: [{ role: "user", content: `News evidence:\n${evidence}` }],
          output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
        });
        const block = response.content.find((item) => item.type === "text");
        if (block && block.type === "text") {
          const output = outputSchema.parse(JSON.parse(block.text));
          summary = fitSentences(output.summary, 220);
          cited = output.sources.filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length);
        }
      } catch (error) { reportFailure("cricket_news_summary_failed", error, { query }); }
    }
    if (!summary && !sections.length) return fallback();

    const hosts = [...new Set(cited)].map((n) => { try { return { label: plain(new URL(sources[n - 1].url).hostname.replace(/^www\./, ""), 60), url: sources[n - 1].url }; } catch { return null; } }).filter((source): source is { label: string; url: string } => Boolean(source));
    const card: DigestCardPayload = {
      kind: "digest", kindLabel: "Cricket news", freshness: asOf(now), summary, sections,
      sources: [...hosts, ...(sections.length ? [{ label: "espn.com", url: "https://www.espn.com/cricket/" }] : [])],
      chips: buildChips(events),
    };
    return embedCard(renderDigestText(card), card);
  } catch (error) {
    reportFailure("cricket_news_failed", error, { query });
    return fallback();
  }
}
