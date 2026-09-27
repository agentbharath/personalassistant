import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";
import { searchFlights } from "./serpapi-flights";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

const itinerary = (price: number, airline: string, legs: number) => ({
  price, airline: undefined,
  flights: Array.from({ length: legs }, (_, i) => ({
    departure_airport: { id: i === 0 ? "SJC" : "XXX", time: "2026-11-06 14:41" },
    arrival_airport: { id: i === legs - 1 ? "LAS" : "XXX", time: "2026-11-06 16:14" },
    airline, flight_number: `${airline} ${100 + i}`,
  })),
  total_duration: 93,
});

describe("SerpApi Google Flights provider contract", () => {
  it("sends the route, date and trip type, and normalizes offers cheapest-relevant fields intact", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      best_flights: [itinerary(71, "Frontier", 1)],
      other_flights: [itinerary(95, "Southwest", 2)],
      price_insights: { lowest_price: 71, price_level: "low", typical_price_range: [80, 150] },
      search_metadata: { google_flights_url: "https://google.com/travel/flights?x" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const result = await searchFlights({ origin: "SJC", destination: "LAS", date: "2026-11-06", tripType: "one_way" });
    const [url] = providerFetch.mock.calls[0] as [URL];
    expect(url.toString()).toContain("departure_id=SJC");
    expect(url.toString()).toContain("arrival_id=LAS");
    expect(url.toString()).toContain("outbound_date=2026-11-06");
    expect(result.offers).toEqual([
      { airline: "Frontier", flightNumbers: ["Frontier 100"], originCode: "SJC", destinationCode: "LAS", departAt: "2026-11-06 14:41", arriveAt: "2026-11-06 16:14", stops: 0, durationMin: 93, price: 71, tripType: "one_way" },
      { airline: "Southwest", flightNumbers: ["Southwest 100", "Southwest 101"], originCode: "SJC", destinationCode: "LAS", departAt: "2026-11-06 14:41", arriveAt: "2026-11-06 16:14", stops: 1, durationMin: 93, price: 95, tripType: "one_way" },
    ]);
    expect(result.priceInsight).toEqual({ level: "low", lowestPrice: 71, typicalRange: [80, 150] });
    expect(result.googleFlightsUrl).toBe("https://google.com/travel/flights?x");
  });

  it("throws on an API-reported error, so a real failure never renders as an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid API key" }), { status: 200 })));
    await expect(searchFlights({ origin: "SJC", destination: "LAS", date: "2026-11-06", tripType: "one_way" })).rejects.toThrow("SERPAPI_FLIGHTS_ERROR");
  });
});
