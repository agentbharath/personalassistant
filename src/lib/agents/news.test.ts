import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), publicSearch: vi.fn() }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: mocks.search }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));
vi.mock("./sports-query-runtime", () => ({ extractSportsSlotsForUser: vi.fn() }));
vi.mock("@/lib/tools/sports/espn-cricket", () => ({ fetchCricketRoundup: vi.fn() }));

import { answerNews, storyAge } from "./news";
import { extractCards } from "@/lib/chat/card-payload";

const now = new Date("2026-09-30T18:00:00Z");
const sources = [
  { title: "Tech News | Reuters", url: "https://www.reuters.com/a", snippet: "Anthropic plans an IPO", published: "Wed, 30 Sep 2026 16:00:00 GMT" },
  { title: "Nvidia buyback", url: "https://www.theverge.com/b", snippet: "$150 billion buyback", published: "Tue, 29 Sep 2026 09:00:00 GMT" },
  { title: "Old story", url: "https://example.com/c", snippet: "x" },
];
const output = {
  subject: "tech",
  kindLabel: "Tech news", summary: "Anthropic plans an IPO and Nvidia announced a $150 billion buyback.",
  stories: [{ source: 1, headline: "Anthropic plans a public-benefit IPO", aboutSubject: true }, { source: 2, headline: "Nvidia announces $150B share buyback", aboutSubject: true }],
  chips: ["Anthropic IPO details", "Nvidia buyback impact"],
};
const reply = (value: unknown) => vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(value) }] } as never);

beforeEach(() => { mocks.search.mockReset().mockResolvedValue({ sources }); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

describe("storyAge (free)", () => {
  it("says hours within a day, a short date after, and nothing for a missing or future date", () => {
    expect(storyAge("Wed, 30 Sep 2026 16:00:00 GMT", now)).toBe("2h ago");
    expect(storyAge("Wed, 30 Sep 2026 17:50:00 GMT", now)).toBe("just now");
    expect(storyAge("Tue, 29 Sep 2026 09:00:00 GMT", now)).toBe("Sep 29");
    expect(storyAge(undefined, now)).toBe("");
    expect(storyAge("Thu, 01 Oct 2026 18:00:00 GMT", now)).toBe("");
  });
});

describe("the news digest (free)", () => {
  it("lists each story as a link to its own article with its source and age, never inventing the link or the age", async () => {
    const answer = await answerNews("any tech news", reply(output), "", "2026-09-30", now);
    const card = extractCards(answer).segments[0].card;
    if (card?.kind !== "digest") throw new Error("not a digest");
    expect(card).toMatchObject({ kindLabel: "Tech news", summary: output.summary });
    expect(card.sections).toEqual([{ kind: "stories", title: "Top stories", stories: [
      { headline: "Anthropic plans a public-benefit IPO", meta: "reuters.com · 2h ago", url: "https://www.reuters.com/a" },
      { headline: "Nvidia announces $150B share buyback", meta: "theverge.com · Sep 29", url: "https://www.theverge.com/b" },
    ] }]);
    expect(card.sources.map((source) => source.label)).toEqual(["reuters.com", "theverge.com"]);
    expect(card.chips).toEqual([{ label: "Anthropic IPO details", text: "Anthropic IPO details" }, { label: "Nvidia buyback impact", text: "Nvidia buyback impact" }]);
  });

  it("searches recent news only", async () => {
    await answerNews("any tech news", reply(output), "", "2026-09-30", now);
    expect(mocks.search.mock.calls[0][1]).toMatchObject({ topic: "news" });
  });

  it("drops a story whose source is outside the evidence or repeated, and falls back when none survive", async () => {
    const card = extractCards(await answerNews("q", reply({ ...output, stories: [{ source: 9, headline: "x", aboutSubject: true }, { source: 1, headline: "A", aboutSubject: true }, { source: 1, headline: "B", aboutSubject: true }] }), "", "2026-09-30", now)).segments[0].card;
    expect(card?.kind === "digest" && card.sections[0].kind === "stories" && card.sections[0].stories.map((story) => story.headline)).toEqual(["A"]);
    expect(await answerNews("q", reply({ ...output, stories: [{ source: 9, headline: "x", aboutSubject: true }] }), "", "2026-09-30", now)).toBe("fallback text");
  });

  it("never shows a story the model says is about something else, and widens the search to two weeks before giving up (found live: a war story dressed up as company news)", async () => {
    const offTopic = { ...output, subject: "Cricket Wireless", kindLabel: "Cricket Wireless news", summary: "", stories: [{ source: 1, headline: "Russia hits Ukraine's mobile operator", aboutSubject: false }, { source: 2, headline: "Apple Watch thefts", aboutSubject: false }] };
    const onTopic = { ...output, subject: "Cricket Wireless", kindLabel: "Cricket Wireless news", summary: "Cricket Wireless added 5G home internet.", stories: [{ source: 1, headline: "Cricket Wireless adds 5G home internet", aboutSubject: true }, { source: 2, headline: "Cricket launches 5G on the AT&T network", aboutSubject: true }] };
    const complete = vi.fn().mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(offTopic) }] }).mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(onTopic) }] });
    const card = extractCards(await answerNews("Cricket Wireless", complete as never, "", "2026-09-30", now)).segments[0].card;
    expect(mocks.search.mock.calls.map((call) => call[1].days)).toEqual([3, 14]);
    if (card?.kind !== "digest") throw new Error("not a digest");
    expect(card.kindLabel).toBe("Cricket Wireless news");
    expect(card.sections[0].kind === "stories" && card.sections[0].stories.map((story) => story.headline)).toEqual(["Cricket Wireless adds 5G home internet", "Cricket launches 5G on the AT&T network"]);
  });

  it("falls back to a plain search, never a digest of unrelated stories, when even two weeks holds nothing about the subject", async () => {
    const offTopic = { ...output, stories: [{ source: 1, headline: "Unrelated", aboutSubject: false }] };
    expect(await answerNews("zzqx corp", reply(offTopic), "", "2026-09-30", now)).toBe("fallback text");
    expect(mocks.search.mock.calls.map((call) => call[1].days)).toEqual([3, 14]);
  });

  it("falls back to a plain search when neither window has news, the search keeps failing, or the model response is broken", async () => {
    mocks.search.mockResolvedValue({ sources: [] });
    expect(await answerNews("q", reply(output), "", "2026-09-30", now)).toBe("fallback text");
    mocks.search.mockRejectedValue(new Error("down"));
    expect(await answerNews("q", reply(output), "", "2026-09-30", now)).toBe("fallback text");
    mocks.search.mockResolvedValue({ sources });
    expect(await answerNews("q", vi.fn().mockResolvedValue({ content: [] }), "", "2026-09-30", now)).toBe("fallback text");
  });

  it("recovers when the first three days hold no news at all but the wider search does", async () => {
    mocks.search.mockResolvedValueOnce({ sources: [] });
    const card = extractCards(await answerNews("q", reply(output), "", "2026-09-30", now)).segments[0].card;
    expect(card?.kind).toBe("digest");
    expect(mocks.search.mock.calls.map((call) => call[1].days)).toEqual([3, 14]);
  });
});
