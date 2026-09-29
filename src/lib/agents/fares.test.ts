import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ extract: vi.fn(), search: vi.fn() }));
vi.mock("./flight-query-runtime", () => ({ extractFlightSlotsForUser: mocks.extract }));
vi.mock("@/lib/tools/general/serpapi-flights", () => ({ searchFlights: mocks.search }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: async () => ({ homeLocation: undefined }) }));

import { answerFlightFares } from "./fares";

beforeEach(() => { mocks.extract.mockReset(); mocks.search.mockReset(); });

const slots = (over: object = {}) => ({ kind: "slots" as const, slots: { origin: "SJC", originStatus: "stated" as const, destination: "LAS", date: "2026-11-06", dateStatus: "stated" as const, tripType: "one_way" as const, tripTypeStatus: "stated" as const, ...over } });
const offer = (over: object = {}) => ({ airline: "Frontier", flightNumbers: ["F9 100"], originCode: "SJC", destinationCode: "LAS", departAt: "2026-11-06 14:41", arriveAt: "2026-11-06 16:14", stops: 0, durationMin: 93, price: 71, tripType: "one_way" as const, isTopFlight: false, ...over });

describe("real flight fares, replacing search-snippet guesses (R32)", () => {
  it("renders a real table from the API's own numbers, cheapest option first, no model call needed to get the facts right", async () => {
    mocks.extract.mockResolvedValue(slots());
    mocks.search.mockResolvedValue({ offers: [offer({ price: 95, stops: 1 }), offer()], priceInsight: { level: "low", lowestPrice: 71, typicalRange: [80, 150] }, googleFlightsUrl: "https://x" });
    const answer = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(answer).toContain("**Cheapest real option:** SJC → LAS on Frontier");
    expect(answer).toContain("$71 one-way, nonstop");
    expect(answer).toContain("| Frontier | $71 |");
    expect(answer).toContain("$71 is low for this route; typical range is $80–150");
    expect(answer).toContain("[See more on Google Flights](https://x)");
  });

  it("marks an assumed date and trip type in the answer, never presenting a guess as stated", async () => {
    mocks.extract.mockResolvedValue(slots({ dateStatus: "assumed", tripTypeStatus: "assumed" }));
    mocks.search.mockResolvedValue({ offers: [offer()], priceInsight: null, googleFlightsUrl: null });
    const answer = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(answer).toMatch(/\*Assumed: no date given — showing 2026-11-06; one-way \(not stated\)\.\*/);
  });

  it("always names the origin in the headline, and flags it as assumed when it came from the saved home location, not the request (found live: asked 'are these from SJC?' because the origin was never stated anywhere)", async () => {
    mocks.extract.mockResolvedValue(slots({ originStatus: "assumed" }));
    mocks.search.mockResolvedValue({ offers: [offer()], priceInsight: null, googleFlightsUrl: null });
    const answer = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(answer).toContain("**Cheapest real option:** SJC → LAS on Frontier");
    expect(answer).toMatch(/\*Assumed: flying from SJC — your saved home location\.\*/);
  });

  it("also names a genuinely faster or fewer-stop option from Google's own \"best_flights\" pick, not a heuristic invented here (found live: the answer only ever led with cheapest, so a much faster, only-slightly-pricier option never got mentioned)", async () => {
    mocks.extract.mockResolvedValue(slots());
    mocks.search.mockResolvedValue({
      offers: [
        offer({ price: 683, stops: 3, durationMin: 3034, flightNumbers: ["DL 1", "KE 2", "VJ 3"], isTopFlight: false }),
        offer({ price: 839, stops: 2, durationMin: 1410, flightNumbers: ["UA 1", "LH 2"], isTopFlight: true }),
      ],
      priceInsight: null, googleFlightsUrl: null,
    });
    const answer = await answerFlightFares("cheapest flights to Bangalore", "2026-09-25", "u1");
    expect(answer).toMatch(/\*\*Cheapest real option:\*\* SJC → LAS on Frontier, \w+, Nov 6, \$683 one-way, 3 stops, 50h 34m\./);
    expect(answer).toMatch(/\*\*Best balance of price and time:\*\* SJC → LAS on Frontier, \w+, Nov 6, \$839 one-way, 2 stops, 23h 30m\./);
  });

  it("never adds a second line when the cheapest option already is Google's own top pick, or when a top pick isn't actually faster or fewer stops", async () => {
    mocks.extract.mockResolvedValue(slots());
    mocks.search.mockResolvedValue({ offers: [offer({ isTopFlight: true })], priceInsight: null, googleFlightsUrl: null });
    const same = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(same).not.toContain("Best balance of price and time");

    mocks.search.mockResolvedValue({
      offers: [
        offer({ price: 71, stops: 0, durationMin: 93, flightNumbers: ["F9 100"], isTopFlight: false }),
        offer({ price: 200, stops: 0, durationMin: 90, flightNumbers: ["AA 200"], isTopFlight: true }),
      ],
      priceInsight: null, googleFlightsUrl: null,
    });
    const barelyFaster = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(barelyFaster).not.toContain("Best balance of price and time");
  });

  it("asks rather than guessing when a slot is missing or ambiguous", async () => {
    mocks.extract.mockResolvedValue({ kind: "ask", question: "Which city are you flying to?", choices: [] });
    expect(await answerFlightFares("cheapest flights somewhere", "2026-09-25", "u1")).toBe("Which city are you flying to?");
  });

  it("says the AI model isn't available rather than guessing, and looks nothing up, when extraction is unavailable", async () => {
    mocks.extract.mockResolvedValue({ kind: "unavailable" });
    expect(await answerFlightFares("cheapest flights somewhere", "2026-09-25", "u1")).toMatch(/AI model isn't available/);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("fails honestly with a real Google Flights link, never falling back to guessed search-snippet numbers", async () => {
    mocks.extract.mockResolvedValue(slots());
    mocks.search.mockRejectedValue(new Error("SERPAPI_FLIGHTS_500"));
    const answer = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(answer).toMatch(/couldn't get live fares right now/);
    expect(answer).toContain("google.com/travel/flights");
  });

  it("says so plainly, with a link, when the search itself came back with nothing", async () => {
    mocks.extract.mockResolvedValue(slots());
    mocks.search.mockResolvedValue({ offers: [], priceInsight: null, googleFlightsUrl: null });
    const answer = await answerFlightFares("cheapest flights to Vegas", "2026-09-25", "u1");
    expect(answer).toMatch(/No fares came back/);
    expect(answer).toContain("google.com/travel/flights");
  });
});
