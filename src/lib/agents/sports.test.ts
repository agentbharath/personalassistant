import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ slots: vi.fn(), summary: vi.fn(), publicSearch: vi.fn() }));
vi.mock("./sports-query-runtime", () => ({ extractSportsSlotsForUser: mocks.slots }));
vi.mock("@/lib/tools/sports/espn", () => ({ fetchTeamSummary: mocks.summary }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));

import { answerSports, buildSportsCard } from "./sports";
import type { TeamGame, TeamSummary } from "@/lib/tools/sports/espn";

const game = (over: Partial<TeamGame> = {}): TeamGame => ({
  opponent: "Arizona Cardinals", isHome: true, date: "2026-09-27T00:00Z",
  status: "final", statusDetail: "Final", teamScore: 36, opponentScore: 30, result: "win",
  ...over,
});
const summary = (over: Partial<TeamSummary> = {}): TeamSummary => ({ teamName: "San Francisco 49ers", record: "3-0", game: game(), nextGame: null, ...over });

beforeEach(() => { mocks.slots.mockReset(); mocks.summary.mockReset(); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

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

describe("answerSports (free)", () => {
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
