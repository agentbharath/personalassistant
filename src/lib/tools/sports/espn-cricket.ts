import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type CricketMatch = {
  teamName: string;
  opponent: string;
  isHome: boolean;
  date: string; // ISO
  status: "final" | "in_progress" | "scheduled";
  statusDetail: string; // "Final", "Live", "Scheduled"
  /** The plain-English result ESPN itself gives ("India won by 8 wkts (50b rem)"), never composed from the raw score -- cricket results
   * (by wickets, by runs, by an innings, no result/rain) don't reduce to a simple higher-number-wins comparison the way other sports do. */
  summary: string;
  myScore: string; // "300/2 (41.4/50 ov, target 296)" -- a formatted string, not a single number: cricket has no equivalent of "the score"
  opponentScore: string;
  result: "win" | "loss" | "no_result" | null;
};

export type CricketTeamSummary = { teamName: string; match: CricketMatch | null };

type EspnCricketTeamRef = { id?: string; displayName?: string; abbreviation?: string };
type EspnCricketCompetitor = { team?: EspnCricketTeamRef; homeAway?: string; score?: string; winner?: boolean | string };
type EspnCricketStatus = { type?: { state?: string; description?: string; shortDetail?: string }; summary?: string };
type EspnCricketEvent = { date?: string; competitions?: Array<{ status?: EspnCricketStatus; competitors?: EspnCricketCompetitor[] }> };
type EspnCricketScoreboard = { events?: EspnCricketEvent[] };
type EspnHeaderLeague = { id?: string; name?: string; abbreviation?: string; smartdates?: string[]; events?: Array<{ competitors?: Array<{ displayName?: string; abbreviation?: string }> }> };
type EspnHeaderResponse = { sports?: Array<{ leagues?: EspnHeaderLeague[] }> };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** International cricket has no persistent per-team "schedule" endpoint the way a club or NFL team does -- teams tour each other in
 * short bilateral series that start and end, so ESPN's own currently-active-series list (the same endpoint its own site header uses) is
 * the only way to find which series a named team is playing right now. Real-checked live, 2026-09-29: this list is short (the handful of
 * series actually in progress worldwide at once) and each entry already carries `smartdates`, the exact dates that series actually plays
 * on -- so no date has to be guessed. Matched against the series' own listed competitors, exact name match preferred over a substring
 * one -- found live: matching against the series' free-text NAME instead ("Australia A tour of India") wrongly matched "India" to a
 * junior/development-team tour just because the host country's name appears in the title, when the senior national team's own real
 * series ("West Indies tour of India") was active at the very same time; a substring match on a title can't tell "India" the team from
 * "India" the host, only an exact match against the actual competitor names can. Null when no currently active series names this team;
 * a team between series (nothing scheduled right now) is a real "nothing to show" case, not a resolution failure, so the caller falls
 * back to a plain search either way. */
async function findActiveSeries(teamQuery: string): Promise<{ leagueId: string; dates: string[] } | null> {
  const response = await resilientFetch("espn", "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket", {}, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as EspnHeaderResponse | null;
  const leagues = (body?.sports?.[0]?.leagues ?? []).filter((league): league is EspnHeaderLeague & { id: string; smartdates: string[] } => Boolean(league.id && league.smartdates?.length));
  const query = normalize(teamQuery);
  const namesOf = (league: EspnHeaderLeague) => (league.events?.[0]?.competitors ?? []).flatMap((c) => [c.displayName, c.abbreviation].filter((v): v is string => Boolean(v)));
  const exact = leagues.find((league) => namesOf(league).some((name) => normalize(name) === query));
  const match = exact ?? leagues.find((league) => namesOf(league).some((name) => normalize(name).includes(query)));
  if (!match) return null;
  return { leagueId: match.id, dates: match.smartdates };
}

function toMatch(event: EspnCricketEvent, teamQuery: string): CricketMatch | null {
  const comp = event.competitions?.[0];
  const type = comp?.status?.type;
  const competitors = comp?.competitors ?? [];
  const query = normalize(teamQuery);
  const me = competitors.find((c) => { const name = c.team?.displayName ?? ""; const abbr = c.team?.abbreviation ?? ""; return normalize(name).includes(query) || normalize(abbr) === query; });
  const opponent = competitors.find((c) => c !== me);
  if (!me || !opponent || !event.date) return null;
  const status: CricketMatch["status"] = type?.state === "post" ? "final" : type?.state === "in" ? "in_progress" : "scheduled";
  const iWon = typeof me.winner === "string" ? me.winner === "true" : me.winner === true;
  const theyWon = typeof opponent.winner === "string" ? opponent.winner === "true" : opponent.winner === true;
  const result: CricketMatch["result"] = status !== "final" ? null : iWon ? "win" : theyWon ? "loss" : "no_result";
  return {
    teamName: me.team?.displayName ?? teamQuery,
    opponent: opponent.team?.displayName ?? "an unlisted opponent",
    isHome: me.homeAway === "home",
    date: event.date,
    status,
    statusDetail: type?.shortDetail ?? type?.description ?? "",
    summary: comp?.status?.summary ?? "",
    myScore: me.score ?? "",
    opponentScore: opponent.score ?? "",
    result,
  };
}

/** A named team's most relevant cricket match (live right now, else the most recent final, else the next scheduled one) from ESPN's own
 * live-checked (2026-09-29) currently-active-series list. Every number/score string here comes straight from the response, no model in
 * the loop, the same reasoning already applied to every other sport here. Null when no currently active series names this team. */
export async function fetchCricketTeamSummary(teamQuery: string): Promise<CricketTeamSummary | null> {
  assertToolAllowed("general", "web.search_sports");
  const series = await findActiveSeries(teamQuery);
  if (!series) return null;
  const dates = [...new Set(series.dates.map((date) => date.slice(0, 10).replace(/-/g, "")))].slice(0, 8);
  const settled = await Promise.allSettled(dates.map(async (date) => {
    const response = await resilientFetch("espn", `https://site.api.espn.com/apis/site/v2/sports/cricket/${series.leagueId}/scoreboard?dates=${date}`, {}, { timeoutMs: 8_000, maxAttempts: 2 });
    return response.ok ? await response.json() as EspnCricketScoreboard : null;
  }));
  const matches: CricketMatch[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) continue;
    for (const event of result.value.events ?? []) { const match = toMatch(event, teamQuery); if (match) matches.push(match); }
  }
  if (!matches.length) return null;
  const inProgress = matches.find((match) => match.status === "in_progress");
  const finals = matches.filter((match) => match.status === "final").sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = matches.filter((match) => match.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date));
  const match = inProgress ?? finals[0] ?? upcoming[0] ?? null;
  return { teamName: match?.teamName ?? teamQuery, match };
}
