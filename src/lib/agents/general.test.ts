import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), synthesize: vi.fn() }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: mocks.search }));
vi.mock("@/lib/model/claude", () => ({ synthesizeSearchResults: mocks.synthesize }));
vi.mock("@/lib/cache/public-query-cache", () => ({ withPublicQueryCache: (_query: string, load: () => Promise<string>) => load() }));

import { answerPublicSearch, sourceList } from "./general";

const source = (n: number) => ({ title: `Source ${n}`, url: `https://example.com/${n}`, snippet: `evidence ${n}` });

beforeEach(() => {
  mocks.search.mockReset().mockResolvedValue({ answer: "", sources: [1, 2, 3, 4, 5, 6].map(source) });
  mocks.synthesize.mockReset();
});

describe("a web search answer (free)", () => {
  it("keeps the bold names and bullet list the model wrote, and drops headings", async () => {
    mocks.synthesize.mockResolvedValue("## Chinese restaurants in Sunnyvale:\n- **Ginger Cafe** — Chinese with Southeast Asian influences [1]\n- **Asia Village** — pickup or delivery [4]");
    const answer = await answerPublicSearch("Chinese restaurants in Sunnyvale, CA");
    expect(answer).toContain("- **Ginger Cafe** — Chinese with Southeast Asian influences [1]");
    expect(answer).not.toMatch(/^## /m);
  });

  it("numbers each source the way the answer cites it, and lists only the ones it cites", async () => {
    mocks.synthesize.mockResolvedValue("Options:\n- **A** [4]\n- **B** [1]\n- **C** [4]");
    const answer = await answerPublicSearch("x");
    expect(answer).toContain("### Sources\n- **1** · [Source 1](https://example.com/1)\n- **4** · [Source 4](https://example.com/4)");
    expect(answer).not.toContain("Source 2");
  });

  it("sends the model exactly the five numbered sources the reader can see", async () => {
    mocks.synthesize.mockResolvedValue("- **A** [1]");
    await answerPublicSearch("x");
    expect(mocks.synthesize.mock.calls[0][1]).toHaveLength(5);
  });

  it("lists the first three sources when the answer cites none, and ignores a citation that points at no source", () => {
    expect(sourceList("No citations here.", [source(1), source(2), source(3), source(4)])).toContain("- **3** ·");
    expect(sourceList("Only [9] here.", [source(1), source(2)])).toContain("- **1** ·");
    expect(sourceList("x", [])).toBe("");
  });

  it("turns a link the model wrote into plain text, so untrusted results cannot put links in the answer", async () => {
    mocks.synthesize.mockResolvedValue("- **A** see [click](https://evil.example/x) [1]");
    expect(await answerPublicSearch("x")).toContain("see click (https://evil.example/x) [1]");
  });
});
