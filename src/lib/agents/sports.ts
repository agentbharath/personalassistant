import { embedCard, type SportsCardPayload } from "@/lib/chat/card-payload";
import { fetchTeamSummary, type TeamSummary } from "@/lib/tools/sports/espn";
import { fetchCricketTeamSummary, type CricketTeamSummary } from "@/lib/tools/sports/espn-cricket";
import { extractSportsSlotsForUser } from "./sports-query-runtime";
import { answerPublicSearch } from "./general";

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return iso; }
}

/** Every number here comes straight from the schedule, no model in the loop -- the same reasoning R32/R45 already applied to places,
 * fares, weather and stocks. */
export function buildSportsCard(summary: TeamSummary): SportsCardPayload {
  const { game, nextGame, teamName, record } = summary;
  const opponentLabel = game ? `${game.isHome ? "vs" : "at"} ${game.opponent}` : "";
  const stats: { label: string; value: string }[] = [];
  if (record) stats.push({ label: "Record", value: record });
  if (nextGame && nextGame !== game) stats.push({ label: "Next game", value: `${nextGame.isHome ? "vs" : "at"} ${nextGame.opponent}, ${formatDate(nextGame.date)}` });

  if (!game) {
    return {
      kind: "sports", eyebrow: teamName, headline: "No game found", statusLabel: "", resultDirection: "flat",
      opponentLabel: "", insight: "No recent or upcoming game came back for this team.", stats, attribution: "espn.com · updated just now",
    };
  }
  if (game.status === "scheduled") {
    return {
      kind: "sports", eyebrow: teamName, headline: opponentLabel, statusLabel: game.statusDetail, resultDirection: "flat",
      opponentLabel, insight: `Their next game is ${game.isHome ? "at home" : "on the road"} against ${game.opponent}.`, stats, attribution: "espn.com · updated just now",
    };
  }
  const headline = `${game.teamScore}–${game.opponentScore}`;
  if (game.status === "in_progress") {
    return {
      kind: "sports", eyebrow: teamName, headline, statusLabel: game.statusDetail, resultDirection: "flat",
      opponentLabel, insight: `Live now, ${opponentLabel}.`, stats, attribution: "espn.com · updated just now",
    };
  }
  const direction = game.result === "win" ? "up" : game.result === "loss" ? "down" : "flat";
  const resultWord = game.result === "win" ? "Won" : game.result === "loss" ? "Lost" : "Tied";
  return {
    kind: "sports", eyebrow: teamName, headline, statusLabel: `Final · ${game.result === "win" ? "W" : game.result === "loss" ? "L" : "T"}`,
    resultDirection: direction, opponentLabel, insight: `${resultWord} ${opponentLabel}.`, stats, attribution: "espn.com · updated just now",
  };
}

/** Cricket has no equivalent of "the score" (a single number), no fixed win-by-higher-number rule (by wickets, by runs, by an innings, or
 * no result), and no readily-available season record the way a club or franchise does -- so this never reuses buildSportsCard's number
 * comparisons, only the same card shape and status-chip convention. */
export function buildCricketCard(summary: CricketTeamSummary): SportsCardPayload {
  const { teamName, match } = summary;
  if (!match) {
    return {
      kind: "sports", eyebrow: teamName, headline: "No match found", statusLabel: "", resultDirection: "flat",
      opponentLabel: "", insight: "No recent or upcoming match came back for this team.", stats: [], attribution: "espn.com · updated just now",
    };
  }
  const opponentLabel = `${match.isHome ? "vs" : "at"} ${match.opponent}`;
  if (match.status === "scheduled") {
    return {
      kind: "sports", eyebrow: teamName, headline: opponentLabel, statusLabel: match.statusDetail, resultDirection: "flat",
      opponentLabel, insight: `Their next match is ${match.isHome ? "at home" : "on the road"} against ${match.opponent}.`, stats: [], attribution: "espn.com · updated just now",
    };
  }
  const headline = `${match.myScore || "—"} vs ${match.opponentScore || "—"}`;
  if (match.status === "in_progress") {
    return {
      kind: "sports", eyebrow: teamName, headline, statusLabel: match.statusDetail || "Live", resultDirection: "flat",
      opponentLabel, insight: match.summary || `Live now, ${opponentLabel}.`, stats: [], attribution: "espn.com · updated just now",
    };
  }
  const direction = match.result === "win" ? "up" : match.result === "loss" ? "down" : "flat";
  return {
    kind: "sports", eyebrow: teamName, headline, statusLabel: `Final${match.result === "win" ? " · W" : match.result === "loss" ? " · L" : ""}`,
    resultDirection: direction, opponentLabel, insight: match.summary || `${opponentLabel}.`, stats: [], attribution: "espn.com · updated just now",
  };
}

function renderSportsText(card: SportsCardPayload): string {
  return `### ${card.eyebrow}\n\n${card.headline}${card.statusLabel ? ` · ${card.statusLabel}` : ""}\n\n${card.insight}`;
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
    const card = buildSportsCard(summary);
    return embedCard(renderSportsText(card), card);
  } catch {
    return fallback();
  }
}
