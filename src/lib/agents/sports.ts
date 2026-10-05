import { embedCard, type ScoreCardPayload, type ScoresCardPayload, type SportsCardPayload, type SportsSide } from "@/lib/chat/card-payload";
import { fetchTeamSummary, type TeamSummary } from "@/lib/tools/sports/espn";
import { fetchCricketRoundup, fetchCricketTeamSummary, type CricketMatch, type CricketRoundupEvent, type CricketTeamSummary } from "@/lib/tools/sports/espn-cricket";
import { extractSportsSlotsForUser } from "./sports-query-runtime";
import { answerPublicSearch } from "./general";

const LEAGUE_LABELS: Record<string, string> = {
  nfl: "NFL", nba: "NBA", wnba: "WNBA", mlb: "MLB", nhl: "NHL", afl: "AFL",
  "eng.1": "Premier League", "esp.1": "La Liga", "ger.1": "Bundesliga", "ita.1": "Serie A", "fra.1": "Ligue 1", "usa.1": "MLS",
};
function leagueLabel(league: string) { return LEAGUE_LABELS[league] ?? league.toUpperCase(); }

function dateTile(iso: string, timeZone = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles") {
  const date = new Date(iso);
  return { month: date.toLocaleDateString("en-US", { month: "short", timeZone }).toUpperCase(), day: date.toLocaleDateString("en-US", { day: "numeric", timeZone }) };
}

const NO_EVENT: Pick<SportsCardPayload, "event" | "upcoming" | "eventLabel" | "statusTag"> = { event: null, upcoming: null, eventLabel: "", statusTag: { label: "", tone: "neutral" } };

/** Every number here comes straight from the schedule, no model in the loop -- the same reasoning R32/R45 already applied to places,
 * fares, weather and stocks. */
export function buildSportsCard(summary: TeamSummary, sport: string, league: string, timeZone = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles"): SportsCardPayload {
  const { game, nextGame, teamName, record } = summary;
  const kindLabel = `${leagueLabel(league)} score`;
  const attribution = "espn.com";

  if (!game) {
    return { kind: "sports", kindLabel, freshness: "", summary: "No recent or upcoming game came back for this team.", attribution, ...NO_EVENT };
  }
  if (game.status === "scheduled") {
    const { month, day } = dateTile(game.date, timeZone);
    return {
      kind: "sports", kindLabel, freshness: "", summary: "", attribution, event: null,
      eventLabel: "", statusTag: { label: "", tone: "neutral" },
      upcoming: { month, day, matchup: `${teamName} ${game.isHome ? "vs" : "at"} ${game.opponent}`, detail: `${leagueLabel(league)} · ${game.isHome ? "Home" : "Away"}` },
    };
  }

  const mySide: SportsSide = { name: teamName, score: String(game.teamScore ?? ""), detail: "", winner: game.result === "win" };
  const oppSide: SportsSide = { name: game.opponent, score: String(game.opponentScore ?? ""), detail: "", winner: game.result === "loss" };
  const sides: [SportsSide, SportsSide] = game.isHome ? [oppSide, mySide] : [mySide, oppSide];
  const eventLabel = `${leagueLabel(league)} · ${game.isHome ? "vs" : "at"} ${game.opponent}`;

  if (game.status === "in_progress") {
    return {
      kind: "sports", kindLabel, freshness: "", summary: `Live now, ${game.isHome ? "vs" : "at"} ${game.opponent}.`, attribution,
      eventLabel, statusTag: { label: game.statusDetail || "Live", tone: "live" }, event: { final: false, sides, outcome: "" }, upcoming: null,
    };
  }
  const winnerName = game.result === "win" ? teamName : game.result === "loss" ? game.opponent : null;
  const margin = Math.abs((game.teamScore ?? 0) - (game.opponentScore ?? 0));
  const outcome = winnerName ? `${winnerName} won by ${margin}.` : `${teamName} and ${game.opponent} tied.`;
  const stats: { label: string; value: string }[] = [];
  if (record) stats.push({ label: "Record", value: record });
  if (nextGame && nextGame !== game) stats.push({ label: "Next game", value: `${nextGame.isHome ? "vs" : "at"} ${nextGame.opponent}` });
  return {
    kind: "sports", kindLabel, freshness: "",
    summary: stats.length ? stats.map((stat) => `${stat.label}: ${stat.value}`).join(" · ") : "",
    attribution, eventLabel, statusTag: { label: "Final", tone: "neutral" }, event: { final: true, sides, outcome }, upcoming: null,
  };
}

/** ESPN packs a cricket score into one string ("300/2 (41.4/50 ov, target 296)"). The card's design puts only the runs/wickets in the big
 * mono slot and the overs small beside it, so the string is split here; the target is dropped because the summary line ("India require
 * 48 runs") already carries it. */
function splitCricketScore(raw: string): { score: string; detail: string } {
  const parsed = /^(\S+)\s*(?:\((.*)\))?$/.exec(raw.trim());
  if (!parsed) return { score: raw || "—", detail: "" };
  const overs = (parsed[2] ?? "").split(",").map((part) => part.trim()).find((part) => part && !part.startsWith("target")) ?? "";
  return { score: parsed[1], detail: overs };
}

/** ESPN's description is "1st ODI,  (D/N) at Thiruvananthapuram" -- the day/night marker and the stray comma are noise. */
function cricketStageVenue(description: string): { stage: string; venue: string } {
  const parsed = /^(.*?),?\s*(?:\([^)]*\)\s*)?(?:at\s+(.+))?$/.exec(description.trim());
  return { stage: parsed?.[1]?.trim() ?? "", venue: parsed?.[2]?.trim() ?? "" };
}

/** "Sep 27" for a cricket match, always in UTC: most venues (South Asia, the Gulf, Africa, Australasia) are far nearer UTC than the
 * server's own zone, so a 05:00 UTC match in Asia stays on its real day instead of sliding to the previous one on a US-zoned machine. */
export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** An unambiguous moment for the calendar step ("Oct 1, 2026 at 10:30 PM America/Los_Angeles"): it needs a year, a clock time and a zone
 * before it will prepare an event -- found live, the chips used to send only "on Oct 1" and got "I need a reliable start time". ESPN's own
 * ISO start is converted to the zone the rest of the app already assumes for this person. */
export function calendarMoment(iso: string): string {
  const zone = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
  const when = new Date(iso);
  const date = when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone });
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${date} at ${time} ${zone}`;
}

/** The whole request for the calendar chips, worded the one way the calendar step reliably accepts: a title, a full date-time with its zone,
 * and a length. Found live: "Add X at Y on Oct 1 to my calendar" got "I need a reliable start time", and even with a time it read as a
 * public event to look up and found nothing; stating it as a titled event with a start and a duration works. A format it knows the length
 * of (an ODI runs about 8 hours, a T20 about 4) gets that length; anything else leaves the calendar step's own default. */
export function calendarRequest(title: string, venue: string, iso: string, format: string): string {
  const hours = /\bODI\b/i.test(format) ? 8 : /T20/i.test(format) ? 4 : 0;
  return `Create a calendar event titled "${title}"${venue ? ` at ${venue}` : ""} on ${calendarMoment(iso)}${hours ? ` for ${hours} hours` : ""}`;
}

/** "1st ODI · Thiruvananthapuram · Sep 27": stage, venue, date. */
function cricketEventLabel(description: string, iso: string): string {
  const { stage, venue } = cricketStageVenue(description);
  return [stage, venue, shortDate(iso)].filter(Boolean).join(" · ");
}

/** "300/2 (41.4/50 ov, target 296)" -> runs, balls bowled, balls in the innings; null when there's no "x/y ov" to work from. */
function cricketBalls(raw: string): { runs: number; used: number; total: number } | null {
  const parsed = /^(\d+)(?:\/\d+)?\s*\((\d+)(?:\.(\d))?\/(\d+)\s*ov/.exec(raw.trim());
  return parsed ? { runs: Number(parsed[1]), used: Number(parsed[2]) * 6 + Number(parsed[3] ?? 0), total: Number(parsed[4]) * 6 } : null;
}

/** The line under the scoreboard. Final: ESPN's own result with "wkts" spelled out and its "(50b rem)" turned into "with 50 balls left".
 * Live chase: "India need 34 from 60 balls" -- the runs are ESPN's, the balls are plain arithmetic on its overs -- with the current and
 * required run rate, plain arithmetic too. Anything that doesn't parse falls back to ESPN's own words, never a guess. */
function cricketOutcome(match: CricketMatch): ScoreCardPayload["outcome"] {
  const raw = match.summary.trim();
  if (!raw) return null;
  if (match.status === "final") {
    const text = raw.replace(/\s*\([^)]*\)\s*$/, "").replace(/\bwkts\b/g, "wickets").replace(/\bwkt\b/g, "wicket");
    const left = /\((\d+)b rem\)/.exec(raw)?.[1];
    return { kind: "result", text, detail: left ? `with ${left} balls left` : "", rates: [] };
  }
  const need = /^(.+?) require (\d+) runs?/i.exec(raw);
  const chasing = cricketBalls(match.battingNow ? match.myScore : match.opponentScore);
  if (need && chasing && chasing.total > chasing.used && chasing.used > 0) {
    const left = chasing.total - chasing.used;
    const required = Number(need[2]);
    return { kind: "chase", text: `${need[1]} need ${required} from ${left} ball${left === 1 ? "" : "s"}`, detail: "", rates: [`CRR ${(chasing.runs / (chasing.used / 6)).toFixed(2)}`, `RRR ${(required / (left / 6)).toFixed(2)}`] };
  }
  return { kind: "chase", text: raw, detail: "", rates: [] };
}

/** Cricket has no equivalent of "the score" (a single number), no fixed win-by-higher-number rule (by wickets, by runs, by an innings, or
 * no result), and no readily-available season record the way a club or franchise does -- so this never reuses buildSportsCard's number
 * comparisons, only the same card shape and status-chip convention. Its own plain-English result sentence (from ESPN, never composed
 * here) is the outcome line. */
export function buildCricketCard(summary: CricketTeamSummary): SportsCardPayload {
  const { teamName, match } = summary;
  const kindLabel = "Cricket score";
  const attribution = "espn.com";
  if (!match) {
    return { kind: "sports", kindLabel, freshness: "", summary: "No recent or upcoming match came back for this team.", attribution, ...NO_EVENT };
  }
  if (match.status === "scheduled") {
    const { month, day } = dateTile(match.date);
    return {
      kind: "sports", kindLabel, freshness: "", summary: "", attribution, event: null,
      eventLabel: "", statusTag: { label: "", tone: "neutral" },
      upcoming: { month, day, matchup: `${teamName} ${match.isHome ? "vs" : "at"} ${match.opponent}`, detail: `Cricket${match.description ? ` · ${match.description}` : ""}` },
    };
  }

  const mySide: SportsSide = { name: teamName, ...splitCricketScore(match.myScore), winner: match.result === "win" };
  const oppSide: SportsSide = { name: match.opponent, ...splitCricketScore(match.opponentScore), winner: match.result === "loss" };
  const sides: [SportsSide, SportsSide] = match.isHome ? [oppSide, mySide] : [mySide, oppSide];
  const eventLabel = cricketEventLabel(match.description, match.date);

  if (match.status === "in_progress") {
    return {
      kind: "sports", kindLabel, freshness: "", summary: match.summary || `Live now, ${match.isHome ? "vs" : "at"} ${match.opponent}.`, attribution,
      eventLabel, statusTag: { label: match.statusDetail || "Live", tone: "live" }, event: { final: false, sides, outcome: "" }, upcoming: null,
    };
  }
  // The design puts the result itself in the status tag ("India won by 8 wkts", green) rather than a generic "Final" plus a line below;
  // ESPN's trailing "(50b rem)" balls-remaining note is dropped. A loss or no-result is never green.
  const result = match.summary.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return {
    kind: "sports", kindLabel, freshness: "", summary: "", attribution,
    eventLabel, statusTag: { label: result || "Final", tone: match.result === "win" ? "good" : "neutral" }, event: { final: true, sides, outcome: "" }, upcoming: null,
  };
}

/** Split "372/2 (40/50 ov, target 406)" into the big runs/wickets and the small overs beside it (the target is in the chase line). */
export function scoreTeam(name: string, raw: string, lead: boolean): ScoreCardPayload["teams"][number] {
  const parsed = /^(.*?)\s*(?:\((.*)\))?$/.exec(raw.trim());
  if (!parsed || !parsed[1]) return { name, score: raw || "—", detail: "", lead };
  const overs = (parsed[2] ?? "").split(",").map((part) => part.trim()).find((part) => part && !part.startsWith("target")) ?? "";
  return { name, score: parsed[1], detail: overs, lead };
}

/** The one-match score card (finished, live or rained-off): every value comes from ESPN's responses, the only arithmetic being balls left
 * and run rates on a live chase. Stat tables are runs and wickets only -- ESPN has no balls faced, strike rate or economy. */
export function buildCricketScoreCard(summary: CricketTeamSummary, match: CricketMatch): ScoreCardPayload {
  const { next, details } = summary;
  const { stage, venue } = cricketStageVenue(match.description);
  const live = match.status === "in_progress";
  const mine = scoreTeam(summary.teamName, match.myScore, live ? match.battingNow : match.result === "win");
  const theirs = scoreTeam(match.opponent, match.opponentScore, live ? !match.battingNow : match.result === "loss");
  const teams: ScoreCardPayload["teams"] = match.isHome ? [theirs, mine] : [mine, theirs];

  const tables: ScoreCardPayload["tables"] = [];
  if (details?.batters.length) tables.push({ title: "Top batters", columns: ["Runs"], rows: details.batters.map((stat) => ({ player: stat.player, side: stat.team, stats: [String(stat.value)] })) });
  if (details?.bowlers.length) tables.push({ title: "Top bowlers", columns: ["Wickets"], rows: details.bowlers.map((stat) => ({ player: stat.player, side: stat.team, stats: [String(stat.value)] })) });

  const facts: ScoreCardPayload["facts"] = [];
  if (match.playerOfMatch) facts.push({ label: "Player of the match", value: match.playerOfMatch });
  if (details?.toss) facts.push({ label: "Toss", value: details.toss });
  const nextStage = next ? cricketStageVenue(next.description) : null;
  const seriesNext = next && nextStage ? `Next: ${[nextStage.stage, shortDate(next.date)].filter(Boolean).join(" ")}${nextStage.venue ? `, ${nextStage.venue}` : ""}` : "";
  const series = [details?.seriesNote, seriesNext].filter(Boolean).join(" · ");
  if (series) facts.push({ label: "Series", value: series });

  const chips: ScoreCardPayload["chips"] = [];
  if (match.scorecardUrl) chips.push({ label: "Full scorecard", url: match.scorecardUrl });
  if (next && nextStage?.stage) chips.push({ label: `Add ${nextStage.stage} to calendar`, act: true, text: calendarRequest(`${summary.teamName} vs ${next.opponent}, ${nextStage.stage}`, nextStage.venue, next.date, nextStage.stage) });
  chips.push({ label: "Other cricket today", text: "Any cricket scores today?" });

  return {
    kind: "score",
    match: `${[stage, venue].filter(Boolean).join(", ")} · ${shortDate(match.date)}`,
    status: live ? { label: "Live", tone: "live" } : match.result === "no_result" ? { label: match.summary || "No result", tone: "disrupted" } : { label: "Final", tone: "final" },
    teams, outcome: cricketOutcome(match), tables, facts,
    sources: [{ label: "espn.com", url: match.scorecardUrl || "https://www.espn.com/cricket/" }],
    chips,
  };
}

/** ESPN's "India won by 8 wkts (50b rem)" as "India won by 8 wickets". */
export function spellOutResult(raw: string) {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").replace(/\bwkts\b/g, "wickets").replace(/\bwkt\b/g, "wicket").trim();
}

/** A roundup of the cricket matches on today: full internationals only when any are on (found live, 2026-09-30: six domestic and A-team
 * matches filled the card and pushed India v West Indies off it), domestic ones only as a fallback when there are none. Live first, then the ones still to start (soonest first), then the ones that finished
 * (latest first), at most six. Every value is ESPN's own; null when nothing is on, so the caller falls back to a plain search. */
export function buildCricketRoundupCard(events: CricketRoundupEvent[]): ScoresCardPayload | null {
  const rank = { in_progress: 0, scheduled: 1, final: 2 } as const;
  const internationals = events.filter((event) => event.international);
  const ordered = [...(internationals.length ? internationals : events)].sort((a, b) => rank[a.status] - rank[b.status] || (a.status === "final" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))).slice(0, 6);
  if (!ordered.length) return null;
  const cards = ordered.map((event): ScoresCardPayload["events"][number] => {
    const label = ["Cricket", event.stage, event.venue].filter(Boolean).join(" · ");
    if (event.status === "scheduled") {
      const when = [shortDate(event.date), event.startsAt].filter(Boolean).join(" · ");
      return { label, tag: { label: when, tone: "highlight" }, sides: event.sides.map((side) => ({ name: side.name, score: "", detail: "", lead: false })) as [ScoreCardPayload["teams"][0], ScoreCardPayload["teams"][0]], outcome: "" };
    }
    const sides = event.sides.map((side) => scoreTeam(side.name, side.score, event.status === "final" && side.winner)) as [ScoreCardPayload["teams"][0], ScoreCardPayload["teams"][0]];
    if (event.status === "in_progress") return { label, tag: { label: "Live", tone: "live" }, sides, outcome: "" };
    const decided = event.sides.some((side) => side.winner);
    return decided
      ? { label, tag: { label: "Final", tone: "neutral" }, sides, outcome: spellOutResult(event.summary) }
      : { label, tag: { label: "No result", tone: "catch" }, sides, outcome: event.summary };
  });
  return { kind: "scores", kindLabel: "Cricket scores today", freshness: "", events: cards, sources: [{ label: "espn.com", url: "https://www.espn.com/cricket/scores" }] };
}

function renderScoresText(card: ScoresCardPayload): string {
  return [`### ${card.kindLabel}`, ...card.events.map((event) => `${event.label}: ${event.sides.map((side) => `${side.name}${side.score ? ` ${side.score}` : ""}`).join(" · ")}${event.outcome ? ` — ${event.outcome}` : ""}`)].join("\n\n");
}

function renderScoreText(card: ScoreCardPayload): string {
  return [`### ${card.match}`, card.teams.map((team) => `${team.name} ${team.score}${team.detail ? ` (${team.detail})` : ""}`).join(" · "), card.outcome?.text ?? ""].filter(Boolean).join("\n\n");
}

function renderSportsText(card: SportsCardPayload): string {
  const lines = [`### ${card.kindLabel}`];
  if (card.summary) lines.push(card.summary);
  if (card.event) lines.push(`${card.event.sides.map((side) => `${side.name} ${side.score}`).join(" · ")}${card.event.outcome ? `\n\n${card.event.outcome}` : ""}`);
  if (card.upcoming) lines.push(card.upcoming.matchup);
  return lines.join("\n\n");
}

/**
 * A real team's own score/game from ESPN (R47: the same reasoning already applied to places, fares, weather and stocks -- a search
 * snippet is not a substitute for a source that actually has the data). Scoped to one named team, never a whole league's scores or
 * standings -- the router only reaches this path for a single-team question at all. Falls back to the existing Tavily-backed general
 * search whenever the team can't be resolved or the API has nothing, the same fallback stocks already uses for an unrecognized ticker.
 */
export async function answerSports(query: string, userId: string, memoryContext = "", today?: string): Promise<string> {
  const fallback = () => answerPublicSearch(query, undefined, memoryContext, today);
  try {
    const outcome = await extractSportsSlotsForUser(query, userId);
    if (outcome.kind !== "slots") return fallback();
    if (outcome.slots.sport === "cricket" && outcome.slots.roundup) {
      const card = buildCricketRoundupCard(await fetchCricketRoundup() ?? []);
      if (!card) return fallback();
      return embedCard(renderScoresText(card), card);
    }
    if (outcome.slots.sport === "cricket") {
      const summary = await fetchCricketTeamSummary(outcome.slots.team);
      if (!summary) return fallback();
      if (summary.match && summary.match.status !== "scheduled") {
        const card = buildCricketScoreCard(summary, summary.match);
        return embedCard(renderScoreText(card), card);
      }
      const card = buildCricketCard(summary);
      return embedCard(renderSportsText(card), card);
    }
    const summary = await fetchTeamSummary(outcome.slots.sport, outcome.slots.league, outcome.slots.team);
    if (!summary) return fallback();
    const card = buildSportsCard(summary, outcome.slots.sport, outcome.slots.league);
    return embedCard(renderSportsText(card), card);
  } catch {
    return fallback();
  }
}
