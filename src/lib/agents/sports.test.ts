import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ slots: vi.fn(), summary: vi.fn(), cricketSummary: vi.fn(), cricketRoundup: vi.fn(), publicSearch: vi.fn() }));
vi.mock("./sports-query-runtime", () => ({ extractSportsSlotsForUser: mocks.slots }));
vi.mock("@/lib/tools/sports/espn", () => ({ fetchTeamSummary: mocks.summary }));
vi.mock("@/lib/tools/sports/espn-cricket", () => ({ fetchCricketTeamSummary: mocks.cricketSummary, fetchCricketRoundup: mocks.cricketRoundup }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));

import { answerSports, buildCricketCard, buildCricketRoundupCard, buildCricketScoreCard, buildSportsCard } from "./sports";
import type { TeamGame, TeamSummary } from "@/lib/tools/sports/espn";
import type { CricketMatch, CricketRoundupEvent, CricketTeamSummary } from "@/lib/tools/sports/espn-cricket";

const game = (over: Partial<TeamGame> = {}): TeamGame => ({
  opponent: "Arizona Cardinals", isHome: true, date: "2026-09-27T00:00Z",
  status: "final", statusDetail: "Final", teamScore: 36, opponentScore: 30, result: "win",
  ...over,
});
const summary = (over: Partial<TeamSummary> = {}): TeamSummary => ({ teamName: "San Francisco 49ers", record: "3-0", game: game(), nextGame: null, ...over });

const cricketMatch = (over: Partial<CricketMatch> = {}): CricketMatch => ({
  teamName: "India", opponent: "West Indies", isHome: true, date: "2026-09-27T08:30Z", description: "1st ODI",
  status: "final", statusDetail: "Final", summary: "India won by 8 wkts (50b rem)",
  myScore: "300/2 (41.4/50 ov, target 296)", opponentScore: "295/7", result: "win",
  eventId: "1529227", scorecardUrl: "https://www.espn.in/cricket/scorecard/1529227", playerOfMatch: "Kuldeep Yadav", battingNow: false,
  ...over,
});
const cricketSummary = (over: Partial<CricketTeamSummary> = {}): CricketTeamSummary => ({ teamName: "India", match: cricketMatch(), next: null, details: null, ...over });
const details = { toss: "India, elected to field first", seriesNote: "India led the 3-match series 1-0", batters: [{ player: "Virat Kohli", team: "India", value: 139 }], bowlers: [{ player: "Kuldeep Yadav", team: "India", value: 4 }] };
const nextMatch = cricketMatch({ status: "scheduled", description: "2nd ODI,  (D/N) at Guwahati", date: "2026-09-30T08:30Z", myScore: "", opponentScore: "", result: null, summary: "" });

beforeEach(() => { mocks.slots.mockReset(); mocks.summary.mockReset(); mocks.cricketSummary.mockReset(); mocks.cricketRoundup.mockReset(); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

describe("the sports card (free)", () => {
  it("shows a win, home team second (matching the away-then-home reading order), with the real score and a computed margin", () => {
    const card = buildSportsCard(summary(), "football", "nfl");
    expect(card.kindLabel).toBe("NFL score");
    expect(card.eventLabel).toBe("NFL · vs Arizona Cardinals");
    expect(card.statusTag).toEqual({ label: "Final", tone: "neutral" });
    expect(card.event).toEqual({
      final: true,
      sides: [
        { name: "Arizona Cardinals", score: "30", detail: "", winner: false },
        { name: "San Francisco 49ers", score: "36", detail: "", winner: true },
      ],
      outcome: "San Francisco 49ers won by 6.",
    });
    expect(card.summary).toBe("Record: 3-0");
  });

  it("shows a loss, never dressed up as a win", () => {
    const card = buildSportsCard(summary({ game: game({ teamScore: 20, opponentScore: 27, result: "loss", isHome: false }) }), "football", "nfl");
    expect(card.event?.sides).toEqual([
      { name: "San Francisco 49ers", score: "20", detail: "", winner: false },
      { name: "Arizona Cardinals", score: "27", detail: "", winner: true },
    ]);
    expect(card.event?.outcome).toBe("Arizona Cardinals won by 7.");
  });

  it("shows a live game with a live tag, never claiming a final result mid-game", () => {
    const card = buildSportsCard(summary({ game: game({ status: "in_progress", statusDetail: "Q3 8:42", teamScore: 60, opponentScore: 58, result: null }) }), "basketball", "nba");
    expect(card.statusTag).toEqual({ label: "Q3 8:42", tone: "live" });
    expect(card.event).toEqual({ final: false, sides: [
      { name: "Arizona Cardinals", score: "58", detail: "", winner: false },
      { name: "San Francisco 49ers", score: "60", detail: "", winner: false },
    ], outcome: "" });
    expect(card.summary).toBe("Live now, vs Arizona Cardinals.");
  });

  it("shows an upcoming-game tile, not a score row, when nothing has been played yet", () => {
    const card = buildSportsCard(summary({ game: game({ status: "scheduled", date: "2026-10-04T00:00Z", teamScore: null, opponentScore: null, result: null, opponent: "Denver Broncos" }) }), "football", "nfl");
    expect(card.event).toBeNull();
    expect(card.upcoming).toMatchObject({ matchup: "San Francisco 49ers vs Denver Broncos", detail: "NFL · Home" });
  });

  it("says plainly when nothing came back, never a blank card", () => {
    const card = buildSportsCard(summary({ game: null }), "football", "nfl");
    expect(card.event).toBeNull();
    expect(card.upcoming).toBeNull();
    expect(card.summary).toContain("No recent or upcoming game");
  });
});

describe("the cricket card (free)", () => {
  it("lays a win out as the design does: stage · venue · date, runs big with overs beside, the result in a green tag", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ description: "1st ODI,  (D/N) at Thiruvananthapuram" }) }));
    expect(card.kindLabel).toBe("Cricket score");
    expect(card.eventLabel).toBe("1st ODI · Thiruvananthapuram · Sep 27");
    expect(card.statusTag).toEqual({ label: "India won by 8 wkts", tone: "good" });
    expect(card.event).toEqual({
      final: true,
      sides: [
        { name: "West Indies", score: "295/7", detail: "", winner: false },
        { name: "India", score: "300/2", detail: "41.4/50 ov", winner: true },
      ],
      outcome: "",
    });
  });

  it("copes with a description that has no venue", () => {
    expect(buildCricketCard(cricketSummary()).eventLabel).toBe("1st ODI · Sep 27");
  });

  it("shows a loss, never dressed up as a win or a green tag", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ result: "loss", summary: "West Indies won by 5 runs", isHome: false }) }));
    expect(card.event?.sides.find((side) => side.name === "West Indies")?.winner).toBe(true);
    expect(card.statusTag).toEqual({ label: "West Indies won by 5 runs", tone: "neutral" });
  });

  it("shows a rained-off no-result match plainly, never forcing a winner", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ result: "no_result", summary: "Match abandoned, no result" }) }));
    expect(card.event?.sides.every((side) => !side.winner)).toBe(true);
    expect(card.statusTag).toEqual({ label: "Match abandoned, no result", tone: "neutral" });
  });

  it("shows a live match with a live tag, never claiming a final result mid-match", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ status: "in_progress", statusDetail: "Live", myScore: "120/4 (30 ov)", opponentScore: "", result: null, summary: "" }) }));
    expect(card.statusTag).toEqual({ label: "Live", tone: "live" });
    expect(card.event?.sides.find((side) => side.name === "India")).toMatchObject({ score: "120/4", detail: "30 ov" });
    expect(card.summary).toBe("Live now, vs West Indies.");
  });

  it("shows an upcoming-match tile when there's nothing recent or live", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ status: "scheduled", opponent: "Australia", isHome: false, myScore: "", opponentScore: "", result: null, summary: "" }) }));
    expect(card.event).toBeNull();
    expect(card.upcoming).toMatchObject({ matchup: "India at Australia" });
  });

  it("says plainly when nothing came back, never a blank card", () => {
    const card = buildCricketCard(cricketSummary({ match: null }));
    expect(card.event).toBeNull();
    expect(card.upcoming).toBeNull();
    expect(card.summary).toContain("No recent or upcoming match");
  });
});

describe("the cricket score card (free)", () => {
  it("lays a finished match out as the design does: scoreboard with the winner in ink, the result spelled out, facts, chips", () => {
    const summary = cricketSummary({ match: cricketMatch({ description: "1st ODI,  (D/N) at Thiruvananthapuram" }), next: nextMatch, details });
    const card = buildCricketScoreCard(summary, summary.match!);
    expect(card.match).toBe("1st ODI, Thiruvananthapuram · Sep 27");
    expect(card.status).toEqual({ label: "Final", tone: "final" });
    expect(card.teams).toEqual([
      { name: "West Indies", score: "295/7", detail: "", lead: false },
      { name: "India", score: "300/2", detail: "41.4/50 ov", lead: true },
    ]);
    expect(card.outcome).toEqual({ kind: "result", text: "India won by 8 wickets", detail: "with 50 balls left", rates: [] });
    expect(card.tables.map((table) => table.title)).toEqual(["Top batters", "Top bowlers"]);
    expect(card.tables[0].rows[0]).toEqual({ player: "Virat Kohli", side: "India", stats: ["139"] });
    expect(card.facts).toEqual([
      { label: "Player of the match", value: "Kuldeep Yadav" },
      { label: "Toss", value: "India, elected to field first" },
      { label: "Series", value: "India led the 3-match series 1-0 · Next: 2nd ODI Sep 30, Guwahati" },
    ]);
    expect(card.chips.map((chip) => chip.label)).toEqual(["Full scorecard", "Add 2nd ODI to calendar", "Other cricket today"]);
    expect(card.chips[1]).toMatchObject({ act: true, text: expect.stringMatching(/^Create a calendar event titled "India vs West Indies, 2nd ODI" at Guwahati on Sep 30, 2026 at .+ for 8 hours$/) });
  });

  it("puts a live chase's balls left and run rates in the outcome line, and the batting side in ink", () => {
    const match = cricketMatch({ status: "in_progress", myScore: "372/2 (40/50 ov, target 406)", opponentScore: "405/7", result: null, summary: "India require 34 runs", battingNow: true, playerOfMatch: "" });
    const card = buildCricketScoreCard(cricketSummary({ match }), match);
    expect(card.status).toEqual({ label: "Live", tone: "live" });
    expect(card.teams.find((team) => team.lead)?.name).toBe("India");
    expect(card.outcome).toEqual({ kind: "chase", text: "India need 34 from 60 balls", detail: "", rates: ["CRR 9.30", "RRR 3.40"] });
  });

  it("falls back to ESPN's own words when a live line can't be worked out, never a guess", () => {
    const match = cricketMatch({ status: "in_progress", myScore: "120/4 (30 ov)", opponentScore: "", result: null, summary: "Day 1: India batting", battingNow: true });
    expect(buildCricketScoreCard(cricketSummary({ match }), match).outcome).toEqual({ kind: "chase", text: "Day 1: India batting", detail: "", rates: [] });
  });

  it("shows a rained-off match as disrupted with no lead side, and leaves out tables/facts ESPN didn't give", () => {
    const match = cricketMatch({ result: "no_result", summary: "Match abandoned, no result", playerOfMatch: "" });
    const card = buildCricketScoreCard(cricketSummary({ match }), match);
    expect(card.status).toEqual({ label: "Match abandoned, no result", tone: "disrupted" });
    expect(card.teams.every((team) => !team.lead)).toBe(true);
    expect(card.tables).toEqual([]);
    expect(card.facts).toEqual([]);
  });
});

const roundupEvent = (over: Partial<CricketRoundupEvent> = {}): CricketRoundupEvent => ({
  stage: "2nd ODI", series: "West Indies tour of India", venue: "Guwahati", date: "2026-09-30T08:30Z", status: "in_progress", international: true, format: "ODI", summary: "India require 34 runs", startsAt: "",
  sides: [{ name: "West Indies", score: "405/7", winner: false }, { name: "India", score: "372/2 (40/50 ov, target 406)", winner: false }],
  ...over,
});

describe("the cricket roundup card (free)", () => {
  it("orders live first, then upcoming soonest-first, then finished latest-first, and caps at six", () => {
    const card = buildCricketRoundupCard([
      roundupEvent({ status: "final", stage: "1st ODI", venue: "Thiruvananthapuram", date: "2026-09-27T08:30Z", summary: "India won by 8 wkts (50b rem)", sides: [{ name: "West Indies", score: "295/7", winner: false }, { name: "India", score: "300/2 (41.4/50 ov)", winner: true }] }),
      roundupEvent({ status: "scheduled", stage: "3rd ODI", venue: "Potchefstroom", date: "2026-09-30T11:30Z", summary: "Starts at 14:00 local time", startsAt: "14:00 local", sides: [{ name: "South Africa", score: "", winner: false }, { name: "Australia", score: "", winner: false }] }),
      roundupEvent(),
    ])!;
    expect(card.events.map((event) => event.label)).toEqual(["Cricket · 2nd ODI · Guwahati", "Cricket · 3rd ODI · Potchefstroom", "Cricket · 1st ODI · Thiruvananthapuram"]);
    expect(card.events[0]).toMatchObject({ tag: { label: "Live", tone: "live" }, outcome: "" });
    expect(card.events[1]).toMatchObject({ tag: { label: "Sep 30 · 14:00 local", tone: "highlight" } });
    expect(card.events[1].sides.every((side) => side.score === "")).toBe(true);
    expect(card.events[2]).toMatchObject({ tag: { label: "Final", tone: "neutral" }, outcome: "India won by 8 wickets" });
    expect(card.events[2].sides[1]).toEqual({ name: "India", score: "300/2", detail: "41.4/50 ov", lead: true });
    expect(buildCricketRoundupCard(Array.from({ length: 9 }, () => roundupEvent()))!.events).toHaveLength(6);
  });

  it("shows a finished match with no winner as amber no-result, and keeps a multi-day score whole", () => {
    const card = buildCricketRoundupCard([roundupEvent({ status: "final", summary: "Match abandoned", sides: [{ name: "A", score: "364 & 134/2 (27.5 ov)", winner: false }, { name: "B", score: "", winner: false }] })])!;
    expect(card.events[0].tag).toEqual({ label: "No result", tone: "catch" });
    expect(card.events[0].sides[0]).toMatchObject({ score: "364 & 134/2", detail: "27.5 ov" });
  });

  it("shows only full internationals when any are on, and domestic matches only when there are none", () => {
    const domestic = roundupEvent({ international: false, stage: "13th Match", venue: "Abbottabad" });
    expect(buildCricketRoundupCard([domestic, roundupEvent()])!.events.map((event) => event.label)).toEqual(["Cricket · 2nd ODI · Guwahati"]);
    expect(buildCricketRoundupCard([domestic])!.events.map((event) => event.label)).toEqual(["Cricket · 13th Match · Abbottabad"]);
  });

  it("is null when nothing is on, so the caller falls back to a plain search", () => {
    expect(buildCricketRoundupCard([])).toBeNull();
  });
});

describe("answerSports (free)", () => {
  it("routes a cricket team to the cricket lookup, not the club-schedule one, and embeds a real card", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "cricket", league: "", team: "india" } });
    mocks.cricketSummary.mockResolvedValue(cricketSummary());
    const answer = await answerSports("did India win", "u1");
    expect(answer).toContain("```daylark-card");
    expect(answer).toContain('"kind":"score"');
    expect(answer).toContain("India won by 8 wickets");
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.publicSearch).not.toHaveBeenCalled();
  });

  it("answers a cricket roundup from ESPN's list of matches, never the team lookup", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "cricket", league: "", team: "", roundup: true } });
    mocks.cricketRoundup.mockResolvedValue([roundupEvent()]);
    const answer = await answerSports("what other cricket matches are on today", "u1");
    expect(answer).toContain('"kind":"scores"');
    expect(mocks.cricketSummary).not.toHaveBeenCalled();
    expect(mocks.publicSearch).not.toHaveBeenCalled();
  });

  it("falls back to general search when nothing is on, or ESPN can't be reached, for a roundup", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "cricket", league: "", team: "", roundup: true } });
    mocks.cricketRoundup.mockResolvedValueOnce([]).mockResolvedValueOnce(null);
    expect(await answerSports("what cricket is on", "u1")).toBe("fallback text");
    expect(await answerSports("what cricket is on", "u1")).toBe("fallback text");
  });

  it("falls back to general search when no currently active cricket series names the team", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "cricket", league: "", team: "england" } });
    mocks.cricketSummary.mockResolvedValue(null);
    const answer = await answerSports("did England win", "u1");
    expect(answer).toBe("fallback text");
  });

  it("embeds a real team summary as a card", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "football", league: "nfl", team: "sf" } });
    mocks.summary.mockResolvedValue(summary());
    const answer = await answerSports("what was the score of the niners game", "u1");
    expect(answer).toContain("```daylark-card");
    expect(answer).toContain("NFL score");
    expect(mocks.publicSearch).not.toHaveBeenCalled();
  });

  it("falls back to general search when the team can't be resolved, never guessing a team", async () => {
    mocks.slots.mockResolvedValue({ kind: "unresolved" });
    const answer = await answerSports("what were last night's NBA scores", "u1");
    expect(answer).toBe("fallback text");
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  it("falls back to general search when ESPN has nothing for the resolved team", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "football", league: "nfl", team: "zzz" } });
    mocks.summary.mockResolvedValue(null);
    const answer = await answerSports("zzz score", "u1");
    expect(answer).toBe("fallback text");
  });

  it("falls back to general search on a real failure, the same as weather, fares and stocks do", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "football", league: "nfl", team: "sf" } });
    mocks.summary.mockRejectedValue(new Error("ESPN_500"));
    const answer = await answerSports("niners score", "u1");
    expect(answer).toBe("fallback text");
  });
});
