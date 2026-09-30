import { embedCard, type SportsCardPayload, type SportsSide } from "@/lib/chat/card-payload";
import { fetchTeamSummary, type TeamSummary } from "@/lib/tools/sports/espn";
import { fetchCricketTeamSummary, type CricketTeamSummary } from "@/lib/tools/sports/espn-cricket";
import { extractSportsSlotsForUser } from "./sports-query-runtime";
import { answerPublicSearch } from "./general";

const LEAGUE_LABELS: Record<string, string> = {
  nfl: "NFL", nba: "NBA", wnba: "WNBA", mlb: "MLB", nhl: "NHL",
  "eng.1": "Premier League", "esp.1": "La Liga", "ger.1": "Bundesliga", "ita.1": "Serie A", "fra.1": "Ligue 1", "usa.1": "MLS",
};
function leagueLabel(league: string) { return LEAGUE_LABELS[league] ?? league.toUpperCase(); }

function dateTile(iso: string) {
  const date = new Date(iso);
  return { month: date.toLocaleDateString("en-US", { month: "short" }).toUpperCase(), day: String(date.getDate()) };
}

const NO_EVENT: Pick<SportsCardPayload, "event" | "upcoming" | "eventLabel" | "statusTag"> = { event: null, upcoming: null, eventLabel: "", statusTag: { label: "", tone: "neutral" } };

/** Every number here comes straight from the schedule, no model in the loop -- the same reasoning R32/R45 already applied to places,
 * fares, weather and stocks. */
export function buildSportsCard(summary: TeamSummary, sport: string, league: string): SportsCardPayload {
  const { game, nextGame, teamName, record } = summary;
  const kindLabel = `${leagueLabel(league)} score`;
  const attribution = "espn.com";

  if (!game) {
    return { kind: "sports", kindLabel, freshness: "", summary: "No recent or upcoming game came back for this team.", attribution, ...NO_EVENT };
  }
  if (game.status === "scheduled") {
    const { month, day } = dateTile(game.date);
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

  const mySide: SportsSide = { name: teamName, score: match.myScore || "—", detail: "", winner: match.result === "win" };
  const oppSide: SportsSide = { name: match.opponent, score: match.opponentScore || "—", detail: "", winner: match.result === "loss" };
  const sides: [SportsSide, SportsSide] = match.isHome ? [oppSide, mySide] : [mySide, oppSide];
  const eventLabel = `Cricket${match.description ? ` · ${match.description}` : ""}`;

  if (match.status === "in_progress") {
    return {
      kind: "sports", kindLabel, freshness: "", summary: match.summary || `Live now, ${match.isHome ? "vs" : "at"} ${match.opponent}.`, attribution,
      eventLabel, statusTag: { label: match.statusDetail || "Live", tone: "live" }, event: { final: false, sides, outcome: "" }, upcoming: null,
    };
  }
  return {
    kind: "sports", kindLabel, freshness: "", summary: "", attribution,
    eventLabel, statusTag: { label: "Final", tone: "neutral" }, event: { final: true, sides, outcome: match.summary }, upcoming: null,
  };
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
    if (outcome.slots.sport === "cricket") {
      const summary = await fetchCricketTeamSummary(outcome.slots.team);
      if (!summary) return fallback();
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
