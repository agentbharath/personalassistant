import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";
import { geocodeLocation } from "./open-meteo";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

const found = { name: "Sunnyvale", latitude: 37.37, longitude: -122.04, timezone: "America/Los_Angeles", admin1: "California" };
const empty = () => new Response(JSON.stringify({ results: [] }), { status: 200 });
const hit = () => new Response(JSON.stringify({ results: [found] }), { status: 200 });

describe("Open-Meteo geocoding: a trailing word that isn't part of the place", () => {
  it("returns the place on the first try when the query already matches, with no retry", async () => {
    const providerFetch = vi.fn().mockResolvedValue(hit());
    vi.stubGlobal("fetch", providerFetch);
    const result = await geocodeLocation("Sunnyvale, CA");
    expect(result).toEqual({ name: "Sunnyvale, California", latitude: 37.37, longitude: -122.04, timezone: "America/Los_Angeles" });
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("drops one trailing word and retries when the full query (found live: the place plus a stray word like \"weather\" or \"today\") matches nothing", async () => {
    const providerFetch = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(hit());
    vi.stubGlobal("fetch", providerFetch);
    const result = await geocodeLocation("Sunnyvale, CA weather");
    expect(result?.name).toBe("Sunnyvale, California");
    expect(providerFetch).toHaveBeenCalledTimes(2);
    const [firstUrl] = providerFetch.mock.calls[0] as [URL];
    const [secondUrl] = providerFetch.mock.calls[1] as [URL];
    expect(firstUrl.searchParams.get("name")).toBe("Sunnyvale, CA weather");
    expect(secondUrl.searchParams.get("name")).toBe("Sunnyvale, CA");
  });

  it("drops up to three trailing words (the exact live case: place plus \"weather today\")", async () => {
    const providerFetch = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(empty()).mockResolvedValueOnce(hit());
    vi.stubGlobal("fetch", providerFetch);
    const result = await geocodeLocation("Sunnyvale, CA weather today");
    expect(result?.name).toBe("Sunnyvale, California");
    expect(providerFetch).toHaveBeenCalledTimes(3);
  });

  it("gives up, rather than trimming forever, once nothing matches within three drops", async () => {
    const providerFetch = vi.fn().mockImplementation(async () => empty());
    vi.stubGlobal("fetch", providerFetch);
    const result = await geocodeLocation("not a real place at all");
    expect(result).toBeNull();
    expect(providerFetch).toHaveBeenCalledTimes(4); // the original query plus 3 drops, never fewer than one word
  });
});
