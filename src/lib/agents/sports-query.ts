import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

const outputSchema = z.object({
  resolved: z.boolean(),
  sport: z.string(), league: z.string(), team: z.string(),
});
const JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["resolved", "sport", "league", "team"],
  properties: {
    resolved: { type: "boolean" },
    sport: { type: "string" }, league: { type: "string" }, team: { type: "string" },
  },
} as const;

export type SportsSlots = { sport: string; league: string; team: string };
export type SportsSlotsOutcome = { kind: "slots"; slots: SportsSlots } | { kind: "unresolved" } | { kind: "unavailable" };

/** R47: resolving "the Warriors" to ESPN's own path segments (sport "basketball", league "nba", team "gsw") is real-world knowledge, the
 * same kind of thing already trusted for a stock ticker ("Apple" -> "AAPL") and an airport code ("Sunnyvale" -> "SJC") -- not a
 * classification decision, so a static lookup table of every team in every league would be the wrong tool here. Scoped to one specific,
 * named team's own score, the same way stocks is scoped to one company's own quote, not market commentary: `resolved: false` for
 * anything broader (a whole league's scores, standings, "who's playing tonight"), so the caller falls back to a plain search instead of
 * forcing a single-team answer onto a question that was never about one team. */
export async function extractSportsSlots(query: string, complete: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): Promise<SportsSlotsOutcome> {
  const response = await complete({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    temperature: 0,
    system: `Read a sports question about one specific named team. resolved is about the TEAM only, never which particular game is meant -- a downstream lookup always picks the one relevant game itself (live right now, else the most recent final, else the next scheduled one), so "the game", "last night", "their last game" and similar are never themselves a reason for resolved: false. A team named only by its city, mascot or well-known nickname alone ("the Niners", "the Lakers", "GSW") is a real, specific team -- resolve it with resolved: true; you already know its sport, league and ESPN abbreviation, the same real-world knowledge you'd use to answer a trivia question about it. Only use resolved: false when no single team is actually named: a whole league's scores or standings, "who's playing tonight" with no team named, a player, a bet, odds, or commentary. sport: ESPN's own sport segment ("football", "basketball", "baseball", "hockey", "soccer"). league: ESPN's own league slug for that team's competition ("nfl", "nba", "wnba", "mlb", "nhl", "eng.1" for the Premier League, "usa.1" for MLS, "mens-college-basketball", etc). team: ESPN's own short team abbreviation (lowercase, e.g. "sf", "gsw", "dal"), never the full name. Return JSON only.`,
    messages: [{ role: "user", content: query }],
    output_config: { format: { type: "json_schema", schema: JSON_SCHEMA } },
  });
  const block = response.content.find((item) => item.type === "text");
  if (!block || block.type !== "text") return { kind: "unavailable" };
  let output: z.infer<typeof outputSchema>;
  try { output = outputSchema.parse(JSON.parse(block.text)); } catch { return { kind: "unavailable" }; }
  if (!output.resolved || !output.sport.trim() || !output.league.trim() || !output.team.trim()) return { kind: "unresolved" };
  return { kind: "slots", slots: { sport: output.sport.trim().toLowerCase(), league: output.league.trim().toLowerCase(), team: output.team.trim().toLowerCase() } };
}
