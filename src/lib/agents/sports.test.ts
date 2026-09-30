import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ slots: vi.fn(), summary: vi.fn(), cricketSummary: vi.fn(), publicSearch: vi.fn() }));
vi.mock("./sports-query-runtime", () => ({ extractSportsSlotsForUser: mocks.slots }));
vi.mock("@/lib/tools/sports/espn", () => ({ fetchTeamSummary: mocks.summary }));
vi.mock("@/lib/tools/sports/espn-cricket", () => ({ fetchCricketTeamSummary: mocks.cricketSummary }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));

import { answerSports, buildCricketCard, buildSportsCard } from "./sports";
import type { TeamGame, TeamSummary } from "@/lib/tools/sports/espn";
import type { CricketMatch, CricketTeamSummary } from "@/lib/tools/sports/espn-cricket";

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
  ...over,
});
const cricketSummary = (over: Partial<CricketTeamSummary> = {}): CricketTeamSummary => ({ teamName: "India", match: cricketMatch(), ...over });

beforeEach(() => { mocks.slots.mockReset(); mocks.summary.mockReset(); mocks.cricketSummary.mockReset(); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

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

describe("answerSports (free)", () => {
  it("routes a cricket team to the cricket lookup, not the club-schedule one, and embeds a real card", async () => {
    mocks.slots.mockResolvedValue({ kind: "slots", slots: { sport: "cricket", league: "", team: "india" } });
    mocks.cricketSummary.mockResolvedValue(cricketSummary());
    const answer = await answerSports("did India win", "u1");
    expect(answer).toContain("```daylark-card");
    expect(answer).toContain("India won by 8 wkts");
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.publicSearch).not.toHaveBeenCalled();
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
