import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "@/lib/runtime/resilient-fetch";
import { fetchTeamSummary } from "./espn";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

const event = (opts: { myId: string; myName: string; opponent: string; opponentId: string; date: string; state: "pre" | "in" | "post"; myScore?: number; opponentScore?: number; isHome?: boolean; shortDetail?: string }) => {
  const isHome = opts.isHome !== false;
  return {
    date: opts.date,
    competitions: [{
      status: { type: { state: opts.state, completed: opts.state === "post", description: opts.state === "post" ? "Final" : opts.state === "in" ? "In Progress" : "Scheduled", shortDetail: opts.shortDetail ?? (opts.state === "post" ? "Final" : "Scheduled") } },
      competitors: [
        { team: { id: isHome ? opts.myId : opts.opponentId, displayName: isHome ? opts.myName : opts.opponent }, homeAway: "home", score: opts.state === "pre" ? undefined : { value: isHome ? opts.myScore : opts.opponentScore } },
        { team: { id: isHome ? opts.opponentId : opts.myId, displayName: isHome ? opts.opponent : opts.myName }, homeAway: "away", score: opts.state === "pre" ? undefined : { value: isHome ? opts.opponentScore : opts.myScore } },
      ],
    }],
  };
};

describe("ESPN team schedule, replacing search-snippet guesses for a live/recent score (R47)", () => {
  it("finds the most recent final result and the next scheduled game from a real schedule response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      team: { id: "25", displayName: "San Francisco 49ers", abbreviation: "SF", recordSummary: "3-0" },
      events: [
        event({ myId: "25", myName: "San Francisco 49ers", opponent: "Miami Dolphins", opponentId: "15", date: "2026-09-20T00:00Z", state: "post", myScore: 35, opponentScore: 13, isHome: true }),
        event({ myId: "25", myName: "San Francisco 49ers", opponent: "Arizona Cardinals", opponentId: "22", date: "2026-09-27T00:00Z", state: "post", myScore: 36, opponentScore: 30, isHome: true }),
        event({ myId: "25", myName: "San Francisco 49ers", opponent: "Denver Broncos", opponentId: "7", date: "2026-10-04T00:00Z", state: "pre", isHome: true, shortDetail: "Sat, Oct 4 · 1:00 PM" }),
        event({ myId: "25", myName: "San Francisco 49ers", opponent: "Seattle Seahawks", opponentId: "26", date: "2026-10-11T00:00Z", state: "pre", isHome: false }),
      ],
    }), { status: 200 })));
    const summary = await fetchTeamSummary("football", "nfl", "sf");
    expect(summary?.teamName).toBe("San Francisco 49ers");
    expect(summary?.record).toBe("3-0");
    expect(summary?.game).toEqual({ opponent: "Arizona Cardinals", isHome: true, date: "2026-09-27T00:00Z", status: "final", statusDetail: "Final", teamScore: 36, opponentScore: 30, result: "win" });
    expect(summary?.nextGame?.opponent).toBe("Denver Broncos");
    expect(summary?.nextGame?.statusDetail).toBe("Sat, Oct 4 · 1:00 PM");
  });

  it("prefers a game in progress over the last final or the next scheduled one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      team: { id: "9", displayName: "Golden State Warriors", abbreviation: "GS", recordSummary: "10-5" },
      events: [
        event({ myId: "9", myName: "Golden State Warriors", opponent: "Lakers", opponentId: "13", date: "2026-09-27T00:00Z", state: "post", myScore: 110, opponentScore: 108, isHome: true }),
        event({ myId: "9", myName: "Golden State Warriors", opponent: "Clippers", opponentId: "12", date: "2026-09-29T00:00Z", state: "in", myScore: 60, opponentScore: 58, isHome: true, shortDetail: "Q3 8:42" }),
        event({ myId: "9", myName: "Golden State Warriors", opponent: "Suns", opponentId: "21", date: "2026-10-02T00:00Z", state: "pre", isHome: false }),
      ],
    }), { status: 200 })));
    const summary = await fetchTeamSummary("basketball", "nba", "gsw");
    expect(summary?.game).toMatchObject({ opponent: "Clippers", status: "in_progress", statusDetail: "Q3 8:42", teamScore: 60, opponentScore: 58, result: null });
  });

  it("still matches games when the requested alias isn't the team's own canonical abbreviation in its schedule data (found live: ESPN resolves \"gsw\" to Golden State, but every competitor entry says \"GS\" -- matching by the input string itself silently found zero games for a real, correctly-resolved team; schedule.team.id is what ESPN actually resolved the alias to, and is what every competitor entry carries)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      team: { id: "9", displayName: "Golden State Warriors", abbreviation: "GS", recordSummary: "10-5" },
      events: [
        event({ myId: "9", myName: "Golden State Warriors", opponent: "Lakers", opponentId: "13", date: "2026-09-27T00:00Z", state: "post", myScore: 110, opponentScore: 108, isHome: true }),
      ],
    }), { status: 200 })));
    const summary = await fetchTeamSummary("basketball", "nba", "gsw");
    expect(summary?.game?.opponent).toBe("Lakers");
  });

  it("returns null for a team ESPN doesn't recognize (a real 404), so the caller can fall back to a plain search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await fetchTeamSummary("football", "nfl", "zzz")).toBeNull();
  });

  it("throws on a real transport/server failure, never silently returning null as if the team just wasn't found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(fetchTeamSummary("football", "nfl", "sf")).rejects.toThrow("ESPN_500");
  });
});
