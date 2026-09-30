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
  teamName: "India", opponent: "West Indies", isHome: true, date: "2026-09-27T08:30Z",
  status: "final", statusDetail: "Final", summary: "India won by 8 wkts (50b rem)",
  myScore: "300/2 (41.4/50 ov, target 296)", opponentScore: "295/7", result: "win",
  ...over,
});
const cricketSummary = (over: Partial<CricketTeamSummary> = {}): CricketTeamSummary => ({ teamName: "India", match: cricketMatch(), ...over });

beforeEach(() => { mocks.slots.mockReset(); mocks.summary.mockReset(); mocks.cricketSummary.mockReset(); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

describe("the sports card (free)", () => {
  it("shows a win in green, with the real score and opponent", () => {
    const card = buildSportsCard(summary());
    expect(card.eyebrow).toBe("San Francisco 49ers");
    expect(card.headline).toBe("36–30");
    expect(card.statusLabel).toBe("Final · W");
    expect(card.resultDirection).toBe("up");
    expect(card.opponentLabel).toBe("vs Arizona Cardinals");
    expect(card.insight).toBe("Won vs Arizona Cardinals.");
    expect(card.stats).toEqual([{ label: "Record", value: "3-0" }]);
  });

  it("shows a loss in red, never dressed up as a win", () => {
    const card = buildSportsCard(summary({ game: game({ teamScore: 20, opponentScore: 27, result: "loss", isHome: false }) }));
    expect(card.headline).toBe("20–27");
    expect(card.statusLabel).toBe("Final · L");
    expect(card.resultDirection).toBe("down");
    expect(card.opponentLabel).toBe("at Arizona Cardinals");
    expect(card.insight).toBe("Lost at Arizona Cardinals.");
  });

  it("shows a live game plainly, never claiming a final result mid-game", () => {
    const card = buildSportsCard(summary({ game: game({ status: "in_progress", statusDetail: "Q3 8:42", teamScore: 60, opponentScore: 58, result: null }) }));
    expect(card.headline).toBe("60–58");
    expect(card.statusLabel).toBe("Q3 8:42");
    expect(card.resultDirection).toBe("flat");
    expect(card.insight).toBe("Live now, vs Arizona Cardinals.");
  });

  it("shows the next game plainly when there's no recent or live one to lead with", () => {
    const card = buildSportsCard(summary({ game: game({ status: "scheduled", statusDetail: "Sat, Oct 4 · 1:00 PM", teamScore: null, opponentScore: null, result: null, opponent: "Denver Broncos" }) }));
    expect(card.headline).toBe("vs Denver Broncos");
    expect(card.statusLabel).toBe("Sat, Oct 4 · 1:00 PM");
    expect(card.resultDirection).toBe("flat");
    expect(card.insight).toBe("Their next game is at home against Denver Broncos.");
  });

  it("includes the next game as a stat when it's a different game than the one being led with", () => {
    const next = game({ status: "scheduled", opponent: "Denver Broncos", date: "2026-10-04T00:00Z", isHome: true });
    const card = buildSportsCard(summary({ nextGame: next }));
    expect(card.stats).toContainEqual({ label: "Next game", value: expect.stringContaining("Denver Broncos") });
  });

  it("says plainly when nothing came back, never a blank card", () => {
    const card = buildSportsCard(summary({ game: null }));
    expect(card.headline).toBe("No game found");
    expect(card.insight).toContain("No recent or upcoming game");
  });
});

describe("the cricket card (free)", () => {
  it("shows a win in green, with the real ESPN result summary, never a wickets-vs-runs comparison invented here", () => {
    const card = buildCricketCard(cricketSummary());
    expect(card.eyebrow).toBe("India");
    expect(card.headline).toBe("300/2 (41.4/50 ov, target 296) vs 295/7");
    expect(card.statusLabel).toBe("Final · W");
    expect(card.resultDirection).toBe("up");
    expect(card.insight).toBe("India won by 8 wkts (50b rem)");
  });

  it("shows a loss in red, never dressed up as a win", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ result: "loss", summary: "West Indies won by 5 runs", isHome: false }) }));
    expect(card.statusLabel).toBe("Final · L");
    expect(card.resultDirection).toBe("down");
    expect(card.opponentLabel).toBe("at West Indies");
  });

  it("shows a rained-off no-result match plainly, never forcing it into a win or a loss", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ result: "no_result", summary: "Match abandoned, no result" }) }));
    expect(card.statusLabel).toBe("Final");
    expect(card.resultDirection).toBe("flat");
    expect(card.insight).toBe("Match abandoned, no result");
  });

  it("shows a live match plainly, never claiming a final result mid-match", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ status: "in_progress", statusDetail: "Live", myScore: "120/4 (30 ov)", opponentScore: "", result: null, summary: "" }) }));
    expect(card.headline).toBe("120/4 (30 ov) vs —");
    expect(card.resultDirection).toBe("flat");
    expect(card.insight).toBe("Live now, vs West Indies.");
  });

  it("shows the next match plainly when there's nothing recent or live", () => {
    const card = buildCricketCard(cricketSummary({ match: cricketMatch({ status: "scheduled", statusDetail: "Sat, Oct 4", opponent: "Australia", isHome: false, myScore: "", opponentScore: "", result: null, summary: "" }) }));
    expect(card.headline).toBe("at Australia");
    expect(card.insight).toBe("Their next match is on the road against Australia.");
  });

  it("says plainly when nothing came back, never a blank card", () => {
    const card = buildCricketCard(cricketSummary({ match: null }));
    expect(card.headline).toBe("No match found");
    expect(card.insight).toContain("No recent or upcoming match");
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
    expect(answer).toContain("San Francisco 49ers");
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
