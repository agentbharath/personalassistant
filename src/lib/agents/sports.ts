import { embedCard, type SportsCardPayload } from "@/lib/chat/card-payload";
import { fetchTeamSummary, type TeamSummary } from "@/lib/tools/sports/espn";
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
    const summary = await fetchTeamSummary(outcome.slots.sport, outcome.slots.league, outcome.slots.team);
    if (!summary) return fallback();
    const card = buildSportsCard(summary);
    return embedCard(renderSportsText(card), card);
  } catch {
    return fallback();
  }
}
