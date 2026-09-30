import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "@/lib/runtime/resilient-fetch";
import { fetchCricketTeamSummary } from "./espn-cricket";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

const header = (leagues: unknown[]) => JSON.stringify({ sports: [{ leagues }] });
const league = (id: string, name: string, dates: string[], competitors: Array<{ displayName: string; abbreviation: string }>) => ({
  id, name, abbreviation: name, smartdates: dates, events: [{ competitors }],
});
const scoreboardEvent = (opts: { date: string; myName: string; myScore: string; myWon: boolean; opponent: string; opponentScore: string; opponentWon: boolean; isHome?: boolean; state: "pre" | "in" | "post"; summary?: string }) => {
  const isHome = opts.isHome !== false;
  const me = { team: { displayName: opts.myName }, homeAway: isHome ? "home" : "away", score: opts.myScore, winner: String(opts.myWon) };
  const them = { team: { displayName: opts.opponent }, homeAway: isHome ? "away" : "home", score: opts.opponentScore, winner: String(opts.opponentWon) };
  return {
    date: opts.date,
    competitions: [{
      status: { type: { state: opts.state, description: opts.state === "post" ? "Result" : opts.state === "in" ? "Live" : "Scheduled", shortDetail: opts.state === "post" ? "Final" : opts.state === "in" ? "Live" : "Scheduled" }, summary: opts.summary ?? "" },
      competitors: isHome ? [me, them] : [them, me],
    }],
  };
};

describe("ESPN cricket, a real national team's own currently-active series (R47)", () => {
  it("matches a team against the series' own real competitors, not the free-text series name (found live: 'India' matched a junior 'India A' tour just because the host country's name appears in that series' title, when India's own senior series was active at the same time)", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(header([
        league("999", "Australia A tour of India 2026/27", ["2026-09-28"], [{ displayName: "Australia A", abbreviation: "AUS A" }, { displayName: "India A", abbreviation: "IND A" }]),
        league("24289", "West Indies tour of India 2026/27", ["2026-09-27"], [{ displayName: "India", abbreviation: "IND" }, { displayName: "West Indies", abbreviation: "WI" }]),
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [scoreboardEvent({ date: "2026-09-27T08:30Z", myName: "India", myScore: "300/2 (41.4/50 ov, target 296)", myWon: true, opponent: "West Indies", opponentScore: "295/7", opponentWon: false, state: "post", summary: "India won by 8 wkts (50b rem)" })] }), { status: 200 })));
    const summary = await fetchCricketTeamSummary("India");
    expect(summary?.teamName).toBe("India");
    expect(summary?.match).toMatchObject({ opponent: "West Indies", result: "win", summary: "India won by 8 wkts (50b rem)", myScore: "300/2 (41.4/50 ov, target 296)", opponentScore: "295/7" });
  });

  it("prefers a live match over a final or scheduled one, checking every date in the series", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(header([league("1", "England tour of India 2026", ["2026-09-20", "2026-09-25", "2026-09-29"], [{ displayName: "England", abbreviation: "ENG" }, { displayName: "India", abbreviation: "IND" }])]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [scoreboardEvent({ date: "2026-09-20T08:30Z", myName: "England", myScore: "250/6", myWon: false, opponent: "India", opponentScore: "251/3", opponentWon: true, state: "post", summary: "India won by 7 wickets" })] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [scoreboardEvent({ date: "2026-09-29T08:30Z", myName: "England", myScore: "120/4 (30 ov)", myWon: false, opponent: "India", opponentScore: "", opponentWon: false, state: "in" })] }), { status: 200 })));
    const summary = await fetchCricketTeamSummary("England");
    expect(summary?.match).toMatchObject({ status: "in_progress", myScore: "120/4 (30 ov)" });
  });

  it("returns null when no currently active series names this team, so the caller falls back to a plain search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(header([league("1", "West Indies tour of India 2026/27", ["2026-09-27"], [{ displayName: "India", abbreviation: "IND" }, { displayName: "West Indies", abbreviation: "WI" }])]), { status: 200 })));
    expect(await fetchCricketTeamSummary("England")).toBeNull();
  });

  it("returns null, never throwing, when the header call itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    expect(await fetchCricketTeamSummary("India")).toBeNull();
  });
});
