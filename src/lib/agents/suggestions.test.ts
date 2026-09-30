import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), publicSearch: vi.fn() }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: (...args: unknown[]) => mocks.search(...args) }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));

import { answerSuggestions } from "./suggestions";

const source = (n: number, host = "rei.com") => ({ title: `Guide ${n}`, url: `https://${host}/${n}`, snippet: `Evidence ${n}` });
const modelReply = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const output = (over: Partial<Record<string, unknown>> = {}) => ({
  kindLabel: "Men's fleece jackets, size M",
  topPick: { name: "Cotopaxi Abrazo", meta: "REI · Medium weight · 4.7 (135)", metric: "$74.83", source: 1, edgeLabel: "44-50% off", edgeTone: "good", reason: "Biggest real discount among well-reviewed jackets." },
  rows: [
    { name: "REI Trailmade", meta: "REI · Heavier, tall sizes · 4.6", metric: "$69.95", source: 2, roleLabel: "Cheapest solid", roleTone: "highlight" },
    { name: "Patagonia Better Sweater", meta: "REI · Medium weight · 4.5 (660)", metric: "$169.00", source: 3, roleLabel: "Premium", roleTone: "neutral" },
  ],
  limit: "Coupons, member prices and cashback aren't included.",
  chips: ["Under $40", "Are they good?", "Compare top 2"],
  ...over,
});
const complete = (value: unknown) => vi.fn().mockResolvedValue(modelReply(value));

beforeEach(() => {
  mocks.search.mockReset().mockResolvedValue({ answer: "", sources: [source(1), source(2), source(3)] });
  mocks.publicSearch.mockReset().mockResolvedValue("fallback text");
});

describe("answerSuggestions (R47)", () => {
  it("embeds a real, grounded suggestion card", async () => {
    const answer = await answerSuggestions("best offers on men's fleece jackets, medium size", complete(output()));
    expect(answer).toContain("```daylark-card");
    expect(answer).toContain("Cotopaxi Abrazo");
    expect(answer).toContain('"kind":"suggestion"');
    expect(mocks.publicSearch).not.toHaveBeenCalled();
  });

  it("grounds every source to a real cited number, never inventing a link for an out-of-range citation", async () => {
    const answer = await answerSuggestions("q", complete(output({ topPick: { ...output().topPick, source: 99 } })));
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.topPick.actionUrl).toBe("");
    expect(card.topPick.actionLabel).toBe("");
  });

  it("caps rows at 3 and chips at 4, and derives a real domain-based action label", async () => {
    const answer = await answerSuggestions("q", complete(output({ rows: [...output().rows, { name: "Extra", meta: "m", metric: "$1", source: 1, roleLabel: "Extra", roleTone: "neutral" }] })));
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.rows).toHaveLength(3);
    expect(card.topPick.actionLabel).toBe("View at rei.com");
  });

  it("falls back to general search when the search itself has nothing", async () => {
    mocks.search.mockResolvedValue({ answer: "", sources: [] });
    const answer = await answerSuggestions("nonexistent thing", complete(output()));
    expect(answer).toBe("fallback text");
  });

  it("falls back to general search when extraction gives no real top pick, never a blank card", async () => {
    const answer = await answerSuggestions("q", complete(output({ topPick: { ...output().topPick, name: "" } })));
    expect(answer).toBe("fallback text");
  });

  it("falls back to general search on a real failure, the same as weather, fares, stocks and sports do", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("MODEL_UNAVAILABLE"));
    const answer = await answerSuggestions("q", failing);
    expect(answer).toBe("fallback text");
  });

  it("falls back to general search, never a crash, on a malformed or missing model response", async () => {
    const malformed = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{\"kindLabel\": not valid json" }] });
    expect(await answerSuggestions("q", malformed)).toBe("fallback text");
    expect(await answerSuggestions("q", vi.fn().mockResolvedValue({ content: [] }))).toBe("fallback text");
  });
});
