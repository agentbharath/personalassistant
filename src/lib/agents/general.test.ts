import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), synthesize: vi.fn() }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: mocks.search }));
vi.mock("@/lib/model/claude", () => ({ synthesizeSearchResults: mocks.synthesize }));
const cacheState = vi.hoisted(() => ({ hit: null as unknown, extras: [] as string[] }));
vi.mock("@/lib/cache/public-query-cache", () => ({ withPublicQueryCache: (_query: string, load: () => Promise<string>, extra = "") => { cacheState.extras.push(extra); return cacheState.hit !== null ? Promise.resolve(cacheState.hit) : load(); } }));

import { answerPublicSearch, sourceList } from "./general";

const source = (n: number) => ({ title: `Source ${n}`, url: `https://example.com/${n}`, snippet: `evidence ${n}` });
const places = (over: object = {}) => ({ kind: "places", intro: "Chinese restaurants in Sunnyvale:", answer: "", caveat: "", items: [
  { name: "Ginger Cafe", address: "", note: "Chinese with Southeast Asian influences", source: 1 },
  { name: "Asia Village", address: "747 S. Wolfe Road", note: "pickup or delivery", source: 4 },
], ...over });

beforeEach(() => {
  cacheState.hit = null; cacheState.extras = [];
  mocks.search.mockReset().mockResolvedValue({ answer: "", sources: [1, 2, 3, 4, 5, 6].map(source) });
  mocks.synthesize.mockReset();
});

describe("a web search answer (free)", () => {
  it("shows places as a card list with a Maps link built by code, and cites the sources", async () => {
    mocks.synthesize.mockResolvedValue(places());
    const answer = await answerPublicSearch("Chinese restaurants in Sunnyvale, CA");
    expect(answer).toContain("Chinese restaurants in Sunnyvale:");
    expect(answer).toContain("- **Ginger Cafe** — Chinese with Southeast Asian influences [1]  \n  [Open in Maps](https://www.google.com/maps/search/?api=1&query=Ginger+Cafe+Sunnyvale%2C+CA)");
    expect(answer).toContain("- **Asia Village** — pickup or delivery [4]  \n  747 S. Wolfe Road · [Open in Maps](https://www.google.com/maps/search/?api=1&query=Asia+Village+747+S.+Wolfe+Road)");
  });

  it("numbers each source the way the answer cites it, and lists only the ones it cites", async () => {
    mocks.synthesize.mockResolvedValue(places());
    const answer = await answerPublicSearch("x");
    expect(answer).toContain("### Sources\n- **1** · [Source 1](https://example.com/1)\n- **4** · [Source 4](https://example.com/4)");
    expect(answer).not.toContain("Source 2");
  });

  it("sends the model exactly the five numbered sources the reader can see", async () => {
    mocks.synthesize.mockResolvedValue(places());
    await answerPublicSearch("x");
    expect(mocks.synthesize.mock.calls[0][1]).toHaveLength(5);
  });

  it("remembers the places shown, so a follow-up can point at them", async () => {
    mocks.synthesize.mockResolvedValue(places());
    const remember = vi.fn().mockResolvedValue(undefined);
    await answerPublicSearch("Chinese restaurants in Sunnyvale, CA", remember);
    expect(remember).toHaveBeenCalledWith({ query: "Chinese restaurants in Sunnyvale, CA", places: [
      { name: "Ginger Cafe", address: "", note: "Chinese with Southeast Asian influences" },
      { name: "Asia Village", address: "747 S. Wolfe Road", note: "pickup or delivery" },
    ] });
  });

  it("remembers nothing for a plain answer, and a failed save never fails the answer", async () => {
    mocks.synthesize.mockResolvedValue({ kind: "answer", intro: "", items: [], answer: "It opens at 9 [1].", caveat: "" });
    const remember = vi.fn();
    expect(await answerPublicSearch("when does it open", remember)).toContain("It opens at 9 [1].");
    expect(remember).not.toHaveBeenCalled();
    mocks.synthesize.mockResolvedValue(places());
    await expect(answerPublicSearch("y", vi.fn().mockRejectedValue(new Error("db")))).resolves.toContain("Ginger Cafe");
  });

  it("turns a link the model wrote in a plain answer into text, so untrusted results cannot put links in it", async () => {
    mocks.synthesize.mockResolvedValue({ kind: "answer", intro: "", items: [], answer: "See [click](https://evil.example/x) [1]", caveat: "" });
    expect(await answerPublicSearch("x")).toContain("See click (https://evil.example/x) [1]");
  });

  it("lists the first three sources when nothing is cited, and ignores a citation that points at no source", () => {
    expect(sourceList("No citations here.", [source(1), source(2), source(3), source(4)])).toContain("- **3** ·");
    expect(sourceList("Only [9] here.", [source(1), source(2)])).toContain("- **1** ·");
    expect(sourceList("x", [])).toBe("");
  });

  it("passes the memory context to synthesis and folds it into the cache key, so a personalized answer is never served for a different fact set (R31)", async () => {
    mocks.synthesize.mockResolvedValue({ kind: "answer", intro: "", items: [], answer: "Marine collagen.", caveat: "" });
    await answerPublicSearch("suggest a collagen supplement", undefined, "Hard fact: doesn't eat meat except fish and chicken");
    expect(mocks.synthesize.mock.calls[0][2]).toBe("Hard fact: doesn't eat meat except fish and chicken");
    expect(cacheState.extras).toEqual(["Hard fact: doesn't eat meat except fish and chicken"]);
  });

  it("reads a saved answer whether the cache gave back text, an object or an old plain string, and still remembers its places", async () => {
    const saved = { text: "Saved answer [1]", places: [{ name: "Ginger Cafe", address: "", note: "" }] };
    const remember = vi.fn().mockResolvedValue(undefined);
    for (const hit of [JSON.stringify(saved), saved]) {
      cacheState.hit = hit;
      expect(await answerPublicSearch("x", remember)).toBe("Saved answer [1]");
    }
    expect(remember).toHaveBeenCalledTimes(2);
    cacheState.hit = "An older plain answer";
    expect(await answerPublicSearch("x", remember)).toBe("An older plain answer");
    cacheState.hit = { unexpected: true };
    expect(await answerPublicSearch("x")).toMatch(/couldn’t read that saved answer/);
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });
});
