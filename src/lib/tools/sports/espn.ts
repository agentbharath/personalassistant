import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type TeamGame = {
  opponent: string;
  isHome: boolean;
  date: string; // ISO
  status: "final" | "in_progress" | "scheduled";
  statusDetail: string; // "Final", "Q3 8:42", "Sat, Oct 4 · 1:00 PM"
  teamScore: number | null;
  opponentScore: number | null;
  result: "win" | "loss" | "tie" | null;
};

export type TeamSummary = {
  teamName: string;
  record: string; // "3-0", "" when not available
  /** The most relevant single game: the one in progress if there is one, else the most recent final, else the next scheduled one. */
  game: TeamGame | null;
  /** The next scheduled game, always included when there is one, even when `game` above already points at it. */
  nextGame: TeamGame | null;
};

type EspnTeamRef = { id?: string; abbreviation?: string; displayName?: string; shortDisplayName?: string; name?: string; location?: string; recordSummary?: string };
type EspnCompetitor = { team?: EspnTeamRef; homeAway?: string; score?: { value?: number } };
type EspnStatusType = { state?: string; completed?: boolean; description?: string; shortDetail?: string };
type EspnEvent = { date?: string; competitions?: Array<{ status?: { type?: EspnStatusType }; competitors?: EspnCompetitor[] }> };
type EspnScheduleResponse = { team?: EspnTeamRef; events?: EspnEvent[] };
type EspnTeamsResponse = { sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: EspnTeamRef }> }> }> };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Only the major US leagues' `/teams/{x}/schedule` accepts a plain abbreviation or common alias directly (confirmed live: "gsw" for
 * Golden State resolves fine). Everywhere else ESPN covers (soccer leagues worldwide, etc.) that same call 400s -- it needs the team's
 * own internal numeric id, which isn't something a model can reliably know off the top of its head the way a stock ticker or airport
 * code already is. Real Madrid's own id ("86") is not real-world knowledge; its name is. So this fetches the league's own team list
 * (still no model in the loop) and matches the name/abbreviation the resolver already gave us against it -- one extra real API call,
 * only when the direct guess didn't already work. */
async function resolveTeamId(sport: string, league: string, teamQuery: string): Promise<string | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(sport)}/${encodeURIComponent(league)}/teams`;
  const response = await resilientFetch("espn", url, {}, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as EspnTeamsResponse | null;
  const teams = body?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const query = normalize(teamQuery);
  const exact = teams.find((entry) => {
    const team = entry.team;
    if (!team?.id) return false;
    return [team.abbreviation, team.displayName, team.shortDisplayName, team.name, team.location, `${team.location ?? ""}${team.name ?? ""}`]
      .some((candidate) => candidate && normalize(candidate) === query);
  });
  if (exact?.team?.id) return exact.team.id;
  const partial = teams.find((entry) => {
    const team = entry.team;
    if (!team?.id) return false;
    return [team.displayName, team.shortDisplayName, team.name].some((candidate) => candidate && normalize(candidate).includes(query));
  });
  return partial?.team?.id ?? null;
}

// Found live: ESPN's team lookup happily resolves a common alias ("gsw" for Golden State) that isn't the team's own canonical
// abbreviation in its schedule data ("GS") -- matching events by the input string silently found zero games for a real, correctly
// resolved team. `schedule.team.id` is what ESPN itself resolved the alias to, and every competitor entry carries that same id, so
// matching on id instead of the caller's own spelling is exact regardless of which alias was used to look the team up.
function toGame(event: EspnEvent, teamId: string): TeamGame | null {
  const comp = event.competitions?.[0];
  const type = comp?.status?.type;
  const competitors = comp?.competitors ?? [];
  const me = competitors.find((c) => c.team?.id === teamId);
  const opponent = competitors.find((c) => c !== me);
  if (!me || !opponent || !event.date) return null;
  const status: TeamGame["status"] = type?.state === "post" ? "final" : type?.state === "in" ? "in_progress" : "scheduled";
  const teamScore = typeof me.score?.value === "number" ? me.score.value : null;
  const opponentScore = typeof opponent.score?.value === "number" ? opponent.score.value : null;
  const result: TeamGame["result"] = status !== "final" || teamScore === null || opponentScore === null ? null
    : teamScore > opponentScore ? "win" : teamScore < opponentScore ? "loss" : "tie";
  return {
    opponent: opponent.team?.displayName ?? "an unlisted opponent",
    isHome: me.homeAway === "home",
    date: event.date,
    status,
    statusDetail: type?.shortDetail ?? type?.description ?? "",
    teamScore, opponentScore, result,
  };
}

/**
 * A real team's most recent/live score and next game, from ESPN's own public scoreboard API (free, keyless, live-checked 2026-09-29 --
 * the same JSON several paid "sports scores API" wrappers on Apify/RapidAPI just resell). Every number here comes straight from the
 * response, no model in the loop, the same reasoning R32/R45 already applied to places, fares, weather and stocks. Tries `team` directly
 * first (an abbreviation/alias, which the major US leagues accept as-is); falls back to resolveTeamId's real team-list lookup for
 * everywhere else (soccer leagues worldwide, etc.) that needs an internal id instead. Null when the team still isn't one ESPN
 * recognizes either way.
 */
export async function fetchTeamSummary(sport: string, league: string, team: string): Promise<TeamSummary | null> {
  assertToolAllowed("general", "web.search_sports");
  const scheduleUrl = (id: string) => `https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(sport)}/${encodeURIComponent(league)}/teams/${encodeURIComponent(id)}/schedule`;
  let response = await resilientFetch("espn", scheduleUrl(team), {}, { timeoutMs: 8_000, maxAttempts: 2 });
  if (response.status === 400 || response.status === 404) {
    const resolvedId = await resolveTeamId(sport, league, team);
    if (!resolvedId) return null;
    response = await resilientFetch("espn", scheduleUrl(resolvedId), {}, { timeoutMs: 8_000, maxAttempts: 2 });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ESPN_${response.status}`);
  const schedule = await response.json().catch(() => null) as EspnScheduleResponse | null;
  if (!schedule?.events?.length || !schedule.team?.id) return null;

  const games = schedule.events.flatMap((event) => { const game = toGame(event, schedule.team!.id!); return game ? [game] : []; });
  if (!games.length) return null; // the team id didn't match either competitor in its own schedule -- not a real team
  const inProgress = games.find((game) => game.status === "in_progress");
  const finals = games.filter((game) => game.status === "final").sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = games.filter((game) => game.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date));
  const game = inProgress ?? finals[0] ?? upcoming[0] ?? null;

  return { teamName: schedule.team?.displayName ?? games[0].opponent, record: schedule.team?.recordSummary ?? "", game, nextGame: upcoming[0] ?? null };
}
