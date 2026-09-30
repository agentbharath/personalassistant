import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

const outputSchema = z.object({
  resolved: z.boolean(),
  sport: z.string(), league: z.string(), team: z.string(),
  roundup: z.boolean().default(false),
});
const JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["resolved", "sport", "league", "team", "roundup"],
  properties: {
    resolved: { type: "boolean" },
    sport: { type: "string" }, league: { type: "string" }, team: { type: "string" },
    roundup: { type: "boolean" },
  },
} as const;

/** Found live, 2026-09-30: once told a matchup still counts, the model also answers resolved: true for sports it was told aren't covered
 * ("rugby" for the All Blacks) -- so which sports reach ESPN is decided here in code, never by the model's resolved flag alone. */
const SUPPORTED_SPORTS = new Set(["football", "soccer", "cricket", "australian-football", "basketball", "baseball", "hockey"]);

/** `roundup` is a list of the cricket matches on today rather than one team's own game -- team is "" then. */
export type SportsSlots = { sport: string; league: string; team: string; roundup?: boolean };
export type SportsSlotsOutcome = { kind: "slots"; slots: SportsSlots } | { kind: "unresolved" } | { kind: "unavailable" };

/** R47: resolving "the Warriors" to ESPN's own path segments (sport "basketball", league "nba", team "gsw") is real-world knowledge, the
 * same kind of thing already trusted for a stock ticker ("Apple" -> "AAPL") and an airport code ("Sunnyvale" -> "SJC") -- not a
 * classification decision, so a static lookup table of every team in every league would be the wrong tool here. Scoped to one specific,
 * named team's own score, the same way stocks is scoped to one company's own quote, not market commentary: `resolved: false` for
 * anything broader (a whole league's scores, standings, "who's playing tonight"), so the caller falls back to a plain search instead of
 * forcing a single-team answer onto a question that was never about one team. Covers soccer worldwide (any domestic league's slug, e.g.
 * "esp.1", is real-world knowledge), AFL, the major US leagues, and international cricket (a national team's own currently-active series
 * is looked up by its real name in code, so cricket needs no league slug at all) -- rugby and others still fall back to a plain search:
 * they need an ESPN-internal numeric competition id with no real-world-knowledge equivalent (and, found live for rugby specifically, real
 * gaps in ESPN's own data even once the right competition is found), not a wrong or invented one. */
export async function extractSportsSlots(query: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): Promise<SportsSlotsOutcome> {
  const response = await complete({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    temperature: 0,
    system: `Read a sports question about one specific named team, anywhere in the world, in soccer/football (any country's league), international cricket (a national team), Australian rules football (AFL), or the major US leagues (NFL, NBA, WNBA, MLB, NHL). A team is named as soon as its city, mascot, well-known nickname, or (for soccer/cricket/AFL) its common short name is said, even alone ("the Niners", "the Lakers", "Real Madrid", "Juventus", "PSG", "Man City", "Bayern", "India", "the West Indies", "Collingwood", "the Crows") -- you already know its sport, league and ESPN path segment (or, for cricket, that no league slug is needed at all), the same real-world knowledge you'd use to answer a trivia question about it, so set resolved: true confidently and fill sport/team; never hedge into resolved: false just because the question is phrased as an open "how did they do" or "did they win" -- those are exactly what this is for. resolved is never about which particular game is meant -- a downstream lookup always picks the one relevant game itself (live right now, else the most recent final, else the next scheduled one). Use resolved: false only when no single team is actually named at all (a whole league's/tournament's scores or standings, "who's playing tonight" with no team named, a player, a bet, odds), or the sport isn't soccer, cricket, AFL, or a major US league (rugby, tennis, golf, motorsport and others aren't covered yet). sport: ESPN's own sport segment ("football" for NFL, "soccer" for football/soccer worldwide, "cricket" for international cricket, "australian-football" for AFL, "basketball", "baseball", "hockey"). league: ESPN's own league slug for that team's own domestic league or main competition (US leagues: "nfl", "nba", "wnba", "mlb", "nhl"; soccer: "eng.1" Premier League, "esp.1" La Liga, "ger.1" Bundesliga, "ita.1" Serie A, "fra.1" Ligue 1, "usa.1" MLS, or the closest equivalent slug for the team's own country's top division; AFL: "afl"); "" for cricket, which needs none. team: for soccer/AFL/US leagues, ESPN's own short team abbreviation, code or common short name (lowercase); for cricket, the national team's real name as commonly said ("india", "west indies", "south africa"), not an abbreviation. A head-to-head matchup naming both sides ("India vs West Indies", "Lakers vs Celtics", "the South Africa Australia game") is still one specific game, never a roundup: set resolved: true and put the FIRST-named side in team -- the downstream lookup finds the game both sides are playing. A country name in a cricket question ("India", "Pakistan", "England", "Australia") is that nation's men's international cricket side: sport "cricket", resolved: true. A request for the list of cricket matches on today, with no single team named ("what other cricket matches are on today", "any cricket scores", "what cricket is on"), is roundup: true with sport "cricket", resolved: true and team ""; roundup is false for every question about one named team. Return JSON only.`,
    messages: [{ role: "user", content: query }],
    output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
  });
  const block = response.content.find((item) => item.type === "text");
  if (!block || block.type !== "text") return { kind: "unavailable" };
  let output: z.infer<typeof outputSchema>;
  try { output = outputSchema.parse(JSON.parse(block.text)); } catch { return { kind: "unavailable" }; }
  const sport = output.sport.trim().toLowerCase();
  if (output.resolved && output.roundup && sport === "cricket") return { kind: "slots", slots: { sport, league: "", team: "", roundup: true } };
  if (!output.resolved || !SUPPORTED_SPORTS.has(sport) || !output.team.trim() || (sport !== "cricket" && !output.league.trim())) return { kind: "unresolved" };
  return { kind: "slots", slots: { sport, league: output.league.trim().toLowerCase(), team: output.team.trim().toLowerCase() } };
}
