import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";
import { searchPublicWeb } from "./tavily-search";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

describe("Tavily provider contract", () => {
  it("uses bounded search settings and domain restrictions", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: "Official event", url: "https://ticketmaster.com/event", content: "Nov 7 at 8 PM" }] }), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const result = await searchPublicWeb("event date", { domains: ["ticketmaster.com"] });
    const init = providerFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ search_depth: "basic", max_results: 5, include_domains: ["ticketmaster.com"], include_raw_content: false });
    expect(result.sources).toHaveLength(1);
  });
});
