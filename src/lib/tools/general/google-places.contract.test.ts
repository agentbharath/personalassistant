import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";
import { searchPlaces } from "./google-places";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

describe("Google Places (New) provider contract", () => {
  it("sends the text query and API key, and normalizes the response", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      places: [
        { displayName: { text: "Ginger Cafe" }, formattedAddress: "123 Main St", rating: 4.3, priceLevel: "PRICE_LEVEL_MODERATE", currentOpeningHours: { openNow: true }, googleMapsUri: "https://maps.google.com/x" },
        { formattedAddress: "no name, skipped" },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const results = await searchPlaces("sushi in Sunnyvale, CA");
    const [url, init] = providerFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBeDefined();
    expect(JSON.parse(init.body as string)).toEqual({ textQuery: "sushi in Sunnyvale, CA" });
    expect(results).toEqual([{ name: "Ginger Cafe", address: "123 Main St", rating: 4.3, priceLevel: "moderate", openNow: true, mapsUri: "https://maps.google.com/x" }]);
  });

  it("throws on a non-ok response, so the caller can fall back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    await expect(searchPlaces("x")).rejects.toThrow("GOOGLE_PLACES_403");
  });
});
