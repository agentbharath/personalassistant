import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ roundup: vi.fn(), search: vi.fn(), publicSearch: vi.fn() }));
vi.mock("@/lib/tools/sports/espn-cricket", () => ({ fetchCricketRoundup: mocks.roundup }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: mocks.search }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));
vi.mock("./sports-query-runtime", () => ({ extractSportsSlotsForUser: vi.fn() }));

import { answerCricketNews, buildDigestSections, fitSentences } from "./cricket-news";
import { extractCards } from "@/lib/chat/card-payload";
import type { CricketRoundupEvent } from "@/lib/tools/sports/espn-cricket";

const event = (over: Partial<CricketRoundupEvent> = {}): CricketRoundupEvent => ({
  stage: "1st ODI", series: "West Indies tour of India", venue: "Thiruvananthapuram", date: "2026-09-27T08:30Z", status: "final", international: true,
  summary: "India won by 8 wkts (50b rem)", startsAt: "",
  sides: [{ name: "West Indies", score: "295/7", winner: false }, { name: "India", score: "300/2 (41.4/50 ov)", winner: true }],
  ...over,
});
const abandoned = event({ stage: "T20I QF", series: "Asian Games", venue: "Nisshin", date: "2026-09-28T05:00Z", summary: "Match abandoned due to rain", sides: [{ name: "India", score: "", winner: false }, { name: "Afghanistan", score: "", winner: false }] });
const upcoming = event({ stage: "2nd ODI", venue: "Guwahati", date: "2026-09-30T08:30Z", status: "scheduled", summary: "Starts at 14:00 local time", startsAt: "14:00 local", sides: [{ name: "India", score: "", winner: false }, { name: "West Indies", score: "", winner: false }] });
const later = event({ stage: "SF 1", venue: "Nisshin", date: "2026-10-01T05:00Z", status: "scheduled", startsAt: "", sides: [{ name: "Bangladesh", score: "", winner: false }, { name: "Pakistan", score: "", winner: false }] });
const news = [{ title: "India beat WI", url: "https://www.hindustantimes.com/a", snippet: "India chased 296", published: "2026-09-28" }, { title: "Rain", url: "https://ndtv.com/b", snippet: "Rain washed out QFs" }];
const reply = (value: unknown) => vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(value) }] } as never);
const now = new Date("2026-09-30T17:40:00Z");

beforeEach(() => { mocks.roundup.mockReset().mockResolvedValue([event(), abandoned, upcoming, later]); mocks.search.mockReset().mockResolvedValue({ sources: news }); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

describe("the digest sections (free)", () => {
  it("builds Result, Abandoned and Coming up from ESPN's data, the soonest upcoming match getting the blue tile", () => {
    const sections = buildDigestSections([event(), abandoned, upcoming, later]);
    expect(sections.map((section) => section.title)).toEqual(["Result", "Abandoned", "Coming up"]);
    const [result, list, tiles] = sections;
    expect(result.kind === "events" && result.events[0]).toMatchObject({ label: "1st ODI · Thiruvananthapuram · Sep 27", tag: { label: "India won by 8 wickets", tone: "good" } });
    expect(list.kind === "list" && list.rows[0]).toEqual({ name: "India vs Afghanistan", meta: "Asian Games · T20I QF · Sep 28", tag: { label: "Rain", tone: "catch" } });
    expect(tiles.kind === "tiles" && tiles.tiles).toEqual([
      { month: "SEP", day: "30", name: "India vs West Indies", meta: "2nd ODI · Guwahati · 14:00 local", next: true },
      { month: "OCT", day: "1", name: "Bangladesh vs Pakistan", meta: "SF 1 · Nisshin", next: false },
    ]);
  });

  it("puts a live match first, labels an abandoned match without rain as no result, and leaves out empty sections", () => {
    const live = event({ status: "in_progress", summary: "India require 34 runs" });
    const plainAbandoned = { ...abandoned, summary: "No result" };
    expect(buildDigestSections([live, plainAbandoned]).map((section) => section.title)).toEqual(["Live now", "Abandoned"]);
    const list = buildDigestSections([plainAbandoned])[0];
    expect(list.kind === "list" && list.rows[0].tag.label).toBe("No result");
    expect(buildDigestSections([])).toEqual([]);
  });

  it("shows only full internationals when any exist", () => {
    const domestic = event({ international: false, stage: "13th Match" });
    const sections = buildDigestSections([domestic, event()]);
    expect(sections).toHaveLength(1);
    expect(sections[0].kind === "events" && sections[0].events).toHaveLength(1);
  });
});

describe("the cricket news digest (free)", () => {
  it("combines a cited news line with ESPN's sections, sources from what the line used plus espn.com, and chips from the match data", async () => {
    const answer = await answerCricketNews("any cricket news", reply({ summary: "India chased down 296 in the 1st ODI.", sources: [1] }), "", "2026-09-30", now);
    const card = extractCards(answer).segments[0].card;
    expect(card).toMatchObject({ kind: "digest", kindLabel: "Cricket news", summary: "India chased down 296 in the 1st ODI.", freshness: expect.stringMatching(/^As of Sep 30, /) });
    if (card?.kind !== "digest") throw new Error("not a digest");
    expect(card.sources).toEqual([{ label: "hindustantimes.com", url: "https://www.hindustantimes.com/a" }, { label: "espn.com", url: "https://www.espn.com/cricket/" }]);
    expect(card.chips).toEqual([
      { label: "Add 2nd ODI to calendar", act: true, text: expect.stringContaining("2nd ODI at Guwahati on Sep 30") },
      { label: "Other cricket today", text: "Any cricket scores today?" },
    ]);
  });

  it("asks the news search for recent news only", async () => {
    await answerCricketNews("any cricket news", reply({ summary: "", sources: [] }), "", "2026-09-30", now);
    expect(mocks.search.mock.calls[0][1]).toMatchObject({ topic: "news" });
  });

  it("drops a citation outside the evidence, and leaves the news line out rather than padding when the model has nothing recent", async () => {
    const cited = extractCards(await answerCricketNews("q", reply({ summary: "x", sources: [9] }), "", "2026-09-30", now)).segments[0].card;
    expect(cited?.kind === "digest" && cited.sources.map((source) => source.label)).toEqual(["espn.com"]);
    const empty = extractCards(await answerCricketNews("q", reply({ summary: "", sources: [] }), "", "2026-09-30", now)).segments[0].card;
    expect(empty?.kind === "digest" && empty.summary).toBe("");
  });

  it("still shows the match sections when the news search or the summary fails", async () => {
    mocks.search.mockRejectedValue(new Error("tavily down"));
    const card = extractCards(await answerCricketNews("q", reply({ summary: "x", sources: [] }), "", "2026-09-30", now)).segments[0].card;
    expect(card?.kind === "digest" && card.sections.length).toBeGreaterThan(0);
    mocks.search.mockResolvedValue({ sources: news });
    const broken = extractCards(await answerCricketNews("q", vi.fn().mockRejectedValue(new Error("boom")), "", "2026-09-30", now)).segments[0].card;
    expect(broken?.kind === "digest" && broken.summary).toBe("");
  });

  it("falls back to a plain search when there is neither news nor any match", async () => {
    mocks.roundup.mockResolvedValue([]);
    expect(await answerCricketNews("q", reply({ summary: "", sources: [] }), "", "2026-09-30", now)).toBe("fallback text");
    mocks.search.mockResolvedValue({ sources: [] });
    expect(await answerCricketNews("q", reply({ summary: "x", sources: [] }), "", "2026-09-30", now)).toBe("fallback text");
  });
});

describe("fitSentences (free)", () => {
  it("keeps whole sentences within the limit and never ends mid-word", () => {
    const text = "South Africa lead the series 2-0 after dominant wins. The 2027 World Cup ticket ballot opens on October 1 for fans worldwide and more.";
    expect(fitSentences(text, 70)).toBe("South Africa lead the series 2-0 after dominant wins.");
    expect(fitSentences("word ".repeat(60), 40).endsWith("…")).toBe(true);
    expect(fitSentences("word ".repeat(60), 40)).not.toMatch(/wor…$/);
    expect(fitSentences("Short.", 70)).toBe("Short.");
  });
});
