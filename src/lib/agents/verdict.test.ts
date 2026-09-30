import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), publicSearch: vi.fn() }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: mocks.search }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));

import { answerVerdict, lastSuggestionItems } from "./verdict";
import { embedCard, extractCards, type SuggestionCardPayload } from "@/lib/chat/card-payload";

const suggestion: SuggestionCardPayload = {
  kind: "suggestion", kindLabel: "Men's fleece jackets, size M", freshness: "Just now",
  topPick: { name: "Cotopaxi Abrazo", meta: "REI · 4.7", metric: "$74.83", edgeTag: null, reason: "Biggest discount", actionLabel: "View at REI", actionUrl: "https://rei.com/a" },
  rows: [
    { name: "REI Trailmade", meta: "REI", metric: "$69.95", roleTag: { label: "Cheapest solid", tone: "highlight" } },
    { name: "Amazon fleece", meta: "Amazon", metric: "~$24", roleTag: { label: "Budget", tone: "neutral" } },
  ],
  limit: "", sources: [], chips: [],
};
const context = [
  { role: "user", content: "find me fleece jackets" },
  { role: "assistant", content: embedCard("### Men's fleece jackets, size M", suggestion) },
  { role: "user", content: "are they good?" },
];
const reply = (value: unknown) => vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(value) }] } as never);
const sources = [{ title: "REI reviews", url: "https://www.rei.com/product/1", snippet: "4.7 from 135 reviews" }, { title: "Amazon", url: "https://amazon.com/x", snippet: "thin, pills" }];
const output = {
  kindLabel: "Verdict on the 3 jackets above", bottomLine: "Around $70, get the Cotopaxi Abrazo.",
  rows: [
    { item: 1, detail: "4.7 from 135 reviews", verdictLabel: "Good buy", verdictTone: "good", source: 1 },
    { item: 3, detail: "Thin, can pill with washing", verdictLabel: "Occasional wear", verdictTone: "catch", source: 2 },
  ],
  chips: ["Compare top 2", "Under $40"],
};

beforeEach(() => { mocks.search.mockReset().mockResolvedValue({ sources }); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

describe("lastSuggestionItems (free)", () => {
  it("finds the options of the most recent suggestions card, top pick first", () => {
    expect(lastSuggestionItems(context)).toEqual({ subject: "Men's fleece jackets, size M", items: [
      { name: "Cotopaxi Abrazo", meta: "REI · 4.7", metric: "$74.83" }, { name: "REI Trailmade", meta: "REI", metric: "$69.95" }, { name: "Amazon fleece", meta: "Amazon", metric: "~$24" },
    ] });
  });
  it("is null when no suggestions card came before", () => {
    expect(lastSuggestionItems([{ role: "assistant", content: "hello" }])).toBeNull();
  });
});

describe("the verdict card (free)", () => {
  it("carries names and prices over from the earlier card, and marks an option the evidence skipped as unrated, never guessed", async () => {
    const answer = await answerVerdict("are they good?", context, reply(output));
    const card = extractCards(answer).segments[0].card;
    expect(card).toMatchObject({ kind: "verdict", kindLabel: "Verdict on the 3 jackets above", basis: "Based on ratings and reviews", bottomLine: "Around $70, get the Cotopaxi Abrazo." });
    if (card?.kind !== "verdict") throw new Error("not a verdict card");
    expect(card.rows).toEqual([
      { name: "Cotopaxi Abrazo", metric: "$74.83", detail: "4.7 from 135 reviews", tag: { label: "Good buy", tone: "good" } },
      { name: "REI Trailmade", metric: "$69.95", detail: "No reviews found for this one", tag: { label: "Unrated", tone: "neutral" } },
      { name: "Amazon fleece", metric: "~$24", detail: "Thin, can pill with washing", tag: { label: "Occasional wear", tone: "catch" } },
    ]);
    expect(card.sources).toEqual([{ label: "rei.com", url: "https://www.rei.com/product/1" }, { label: "amazon.com", url: "https://amazon.com/x" }]);
    expect(card.chips).toEqual(["Compare top 2", "Under $40"]);
  });

  it("drops a citation that points outside the evidence rather than showing a wrong link", async () => {
    const answer = await answerVerdict("are they good?", context, reply({ ...output, rows: [{ ...output.rows[0], source: 9 }] }));
    const card = extractCards(answer).segments[0].card;
    expect(card?.kind === "verdict" && card.sources).toEqual([]);
  });

  it("searches for reviews of the exact earlier options, including what the question asked about", async () => {
    await answerVerdict("are they good?", context, reply(output));
    expect(mocks.search.mock.calls[0][0]).toContain("Cotopaxi Abrazo, REI Trailmade, Amazon fleece");
    expect(mocks.search.mock.calls[0][0]).toContain("are they good?");
  });

  it("falls back to a plain search with no earlier suggestions, no evidence, or no usable verdict", async () => {
    expect(await answerVerdict("are they good?", [{ role: "user", content: "hi" }], reply(output))).toBe("fallback text");
    mocks.search.mockResolvedValueOnce({ sources: [] });
    expect(await answerVerdict("are they good?", context, reply(output))).toBe("fallback text");
    expect(await answerVerdict("are they good?", context, reply({ ...output, bottomLine: "" }))).toBe("fallback text");
    expect(await answerVerdict("are they good?", context, vi.fn().mockRejectedValue(new Error("boom")))).toBe("fallback text");
  });
});
