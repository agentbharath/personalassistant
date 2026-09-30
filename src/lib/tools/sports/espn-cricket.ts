import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type CricketMatch = {
  teamName: string;
  opponent: string;
  isHome: boolean;
  date: string; // ISO
  /** "1st ODI,  (D/N) at Thiruvananthapuram" -- ESPN's own stage+venue line, straight from the response. */
  description: string;
  status: "final" | "in_progress" | "scheduled";
  statusDetail: string; // "Final", "Live", "Scheduled"
  /** The plain-English result ESPN itself gives ("India won by 8 wkts (50b rem)"), never composed from the raw score -- cricket results
   * (by wickets, by runs, by an innings, no result/rain) don't reduce to a simple higher-number-wins comparison the way other sports do. */
  summary: string;
  myScore: string; // "300/2 (41.4/50 ov, target 296)" -- a formatted string, not a single number: cricket has no equivalent of "the score"
  opponentScore: string;
  result: "win" | "loss" | "no_result" | null;
  eventId: string;
  /** ESPN's own scorecard page for this match, when it lists one -- the "Full scorecard" chip's real destination. */
  scorecardUrl: string;
  /** Player of the match, once ESPN has named one (only after the match ends). */
  playerOfMatch: string;
  /** Whether this team is the one currently batting (live only) -- the scoreboard's "lead" emphasis while a match is on. */
  battingNow: boolean;
};

/** Extra match detail from ESPN's per-match summary. Every field is optional/empty when ESPN doesn't have it: this endpoint only
 * carries each innings' top run-scorers and wicket-takers as a single number each (no balls faced, strike rate, runs conceded or
 * economy -- checked live, 2026-09-30), so the tables here are runs and wickets only, never invented columns. */
export type CricketPlayerStat = { player: string; team: string; value: number };
export type CricketMatchDetails = { toss: string; seriesNote: string; batters: CricketPlayerStat[]; bowlers: CricketPlayerStat[] };

export type CricketTeamSummary = {
  teamName: string;
  match: CricketMatch | null;
  /** The next match still to be played in this series after `match`, for the "Add … to calendar" chip and the series fact. */
  next: CricketMatch | null;
  details: CricketMatchDetails | null;
};

type EspnCricketTeamRef = { id?: string; displayName?: string; abbreviation?: string };
type EspnCricketCompetitor = { team?: EspnCricketTeamRef; homeAway?: string; score?: string; winner?: boolean | string; linescores?: Array<{ isBatting?: boolean; isCurrent?: number | boolean }> };
type EspnCricketStatus = { type?: { state?: string; description?: string; shortDetail?: string }; summary?: string; featuredAthletes?: Array<{ abbreviation?: string; athlete?: { displayName?: string } }> };
type EspnCricketEvent = { id?: string; date?: string; links?: Array<{ rel?: string[]; href?: string }>; competitions?: Array<{ status?: EspnCricketStatus; competitors?: EspnCricketCompetitor[]; description?: string; shortDescription?: string }> };
type EspnCricketScoreboard = { events?: EspnCricketEvent[] };
type EspnHeaderEvent = {
  class?: { internationalClassId?: string };
  /** The real result/chase/start-time line lives here; the event's own top-level `summary` is only "Result" or "Scheduled". */
  fullStatus?: { summary?: string };
  date?: string; description?: string; name?: string; status?: string; summary?: string;
  competitors?: Array<{ displayName?: string; abbreviation?: string; score?: string; winner?: boolean | string; order?: number }>;
};
type EspnHeaderLeague = { id?: string; name?: string; abbreviation?: string; smartdates?: string[]; events?: EspnHeaderEvent[] };
type EspnLeaderEntry = { displayValue?: string; athlete?: { displayName?: string } };
type EspnSummary = {
  notes?: Array<{ type?: string; text?: string }>;
  leaders?: Array<{ team?: { displayName?: string }; linescores?: Array<{ isBatting?: boolean; leaders?: Array<{ name?: string; leaders?: EspnLeaderEntry[] }> }> }>;
};
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
    description: comp?.shortDescription ?? comp?.description ?? "",
    status,
    statusDetail: type?.shortDetail ?? type?.description ?? "",
    summary: comp?.status?.summary ?? "",
    myScore: me.score ?? "",
    opponentScore: opponent.score ?? "",
    result,
    eventId: event.id ?? "",
    scorecardUrl: event.links?.find((link) => link.rel?.includes("scorecard"))?.href ?? "",
    playerOfMatch: comp?.status?.featuredAthletes?.find((entry) => entry.abbreviation === "POTM")?.athlete?.displayName ?? "",
    battingNow: status === "in_progress" && Boolean(me.linescores?.some((line) => line.isBatting && Boolean(line.isCurrent))),
  };
}

/** Top run-scorers and wicket-takers, plus the toss and series notes, from ESPN's per-match summary. Null on any failure: the card
 * just has no tables/facts then, never a wrong or partial one. A team's batters are its batting innings' "runs" leaders; its bowlers
 * are its *other* innings' "wickets" leaders (the innings it bowled in). */
async function fetchMatchDetails(leagueId: string, eventId: string): Promise<CricketMatchDetails | null> {
  if (!eventId) return null;
  try {
    const response = await resilientFetch("espn", `https://site.api.espn.com/apis/site/v2/sports/cricket/${leagueId}/summary?event=${eventId}`, {}, { timeoutMs: 8_000, maxAttempts: 2 });
    if (!response.ok) return null;
    const body = await response.json() as EspnSummary;
    const batters: CricketPlayerStat[] = [];
    const bowlers: CricketPlayerStat[] = [];
    for (const team of body.leaders ?? []) {
      for (const line of team.linescores ?? []) {
        for (const category of line.leaders ?? []) {
          const target = category.name === "runs" ? batters : category.name === "wickets" ? bowlers : null;
          if (!target) continue;
          for (const entry of category.leaders ?? []) {
            const value = Number(entry.displayValue);
            if (entry.athlete?.displayName && team.team?.displayName && Number.isFinite(value)) target.push({ player: entry.athlete.displayName, team: team.team.displayName, value });
          }
        }
      }
    }
    const note = (type: string) => body.notes?.find((item) => item.type === type)?.text?.replace(/\s+,/g, ",").trim() ?? "";
    const top = (list: CricketPlayerStat[], count: number) => list.filter((stat) => stat.value > 0).sort((a, b) => b.value - a.value).slice(0, count);
    return { toss: note("toss"), seriesNote: note("seriesnote"), batters: top(batters, 3), bowlers: top(bowlers, 2) };
  } catch { return null; }
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
  const next = match ? upcoming.find((candidate) => candidate.date > match.date) ?? null : null;
  const details = match && match.status !== "scheduled" ? await fetchMatchDetails(series.leagueId, match.eventId) : null;
  return { teamName: match?.teamName ?? teamQuery, match, next, details };
}

/** One match in a roundup of what's on -- exactly what ESPN's own header feed carries for each currently-active series' matches. */
export type CricketRoundupEvent = {
  stage: string; // "2nd ODI"
  venue: string; // "Guwahati"
  date: string; // ISO
  status: "final" | "in_progress" | "scheduled";
  /** A full international (men's or women's) rather than a domestic, A-team or development match -- ESPN's own `internationalClassId`. */
  international: boolean;
  summary: string; // ESPN's own result/chase line
  /** "14:00 local" when ESPN says when a not-yet-started match begins (in the venue's own time, never guessed at a timezone). */
  startsAt: string;
  sides: Array<{ name: string; score: string; winner: boolean }>;
};

/** Every cricket match ESPN lists as live, finishing within the last day, or starting within the next day -- the real answer to "what
 * cricket is on today", from the same header feed the team lookup already reads. Null only when ESPN itself can't be reached; an empty list
 * means nothing is on. */
export async function fetchCricketRoundup(now: Date = new Date()): Promise<CricketRoundupEvent[] | null> {
  assertToolAllowed("general", "web.search_sports");
  const response = await resilientFetch("espn", "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket", {}, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as EspnHeaderResponse | null;
  if (!body) return null;
  const earliest = now.getTime() - 20 * 3_600_000;
  const latest = now.getTime() + 30 * 3_600_000;
  const events: CricketRoundupEvent[] = [];
  for (const league of body.sports?.[0]?.leagues ?? []) {
    for (const event of league.events ?? []) {
      const status: CricketRoundupEvent["status"] = event.status === "post" ? "final" : event.status === "in" ? "in_progress" : "scheduled";
      const time = event.date ? Date.parse(event.date) : NaN;
      if (!Number.isFinite(time) || (status !== "in_progress" && (time < earliest || time > latest))) continue;
      const sides = [...(event.competitors ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((side) => ({ name: side.displayName ?? "", score: side.score ?? "", winner: typeof side.winner === "string" ? side.winner === "true" : side.winner === true }));
      if (sides.length < 2 || sides.some((side) => !side.name)) continue;
      const description = event.description ?? "";
      const summary = event.fullStatus?.summary ?? "";
      events.push({
        stage: (description.split(",")[0] ?? "").replace(/\s*\([^)]*\)/g, "").trim(),
        venue: /\bat ([^,]+),/.exec(description)?.[1]?.trim() ?? "",
        date: event.date!, status, international: Boolean(event.class?.internationalClassId && event.class.internationalClassId !== "0"), summary,
        startsAt: status === "scheduled" && /Starts at (\d{1,2}:\d{2}) local time/.test(summary) ? `${/Starts at (\d{1,2}:\d{2})/.exec(summary)![1]} local` : "",
        sides: [sides[0], sides[1]],
      });
    }
  }
  return events;
}
