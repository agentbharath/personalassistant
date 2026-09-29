import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type FareOffer = {
  airline: string;
  flightNumbers: string[];
  originCode: string;
  destinationCode: string;
  /** Local time, as the airport shows it: "2026-11-06 14:41". Never converted or reformatted here — code that renders this decides how. */
  departAt: string;
  arriveAt: string;
  stops: number;
  durationMin: number;
  price: number;
  tripType: "one_way" | "round_trip";
  /** From SerpApi's own `best_flights` list (Google's own price+convenience-balanced pick), not `other_flights` -- never a heuristic
   * Daylark invents itself, the same reasoning this file's own doc comment already applies to every other field here. */
  isTopFlight: boolean;
};

export type PriceInsight = { level: "low" | "typical" | "high" | "unknown"; lowestPrice: number | null; typicalRange: [number, number] | null };

export type FlightSearchResult = { offers: FareOffer[]; priceInsight: PriceInsight | null; googleFlightsUrl: string | null };

type SerpApiLeg = { departure_airport?: { id?: string; time?: string }; arrival_airport?: { id?: string; time?: string }; airline?: string; flight_number?: string };
type SerpApiItinerary = { flights?: SerpApiLeg[]; total_duration?: number; price?: number };
type SerpApiResponse = {
  error?: string;
  best_flights?: SerpApiItinerary[];
  other_flights?: SerpApiItinerary[];
  price_insights?: { lowest_price?: number; price_level?: string; typical_price_range?: [number, number] };
  search_metadata?: { google_flights_url?: string };
};

function toOffer(itinerary: SerpApiItinerary, tripType: "one_way" | "round_trip", isTopFlight: boolean): FareOffer | null {
  const legs = itinerary.flights ?? [];
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (!first?.departure_airport?.id || !last?.arrival_airport?.id || !first.departure_airport.time || !last.arrival_airport.time || typeof itinerary.price !== "number") return null;
  return {
    airline: first.airline ?? "",
    flightNumbers: legs.flatMap((leg) => leg.flight_number ? [leg.flight_number] : []),
    originCode: first.departure_airport.id,
    destinationCode: last.arrival_airport.id,
    departAt: first.departure_airport.time,
    arriveAt: last.arrival_airport.time,
    stops: Math.max(0, legs.length - 1),
    durationMin: itinerary.total_duration ?? 0,
    price: itinerary.price,
    tripType,
    isTopFlight,
  };
}

/** Real flight offers (times, stops, price) from SerpApi's Google Flights engine, replacing Tavily's aggregator-landing-page snippets for
 * the `fares` kind (R32, 2026-09-26): no formatting can recover a date or a stop count a search snippet never had, so this gets it from a
 * source that actually has it. Single date, single airport pair for now — no multi-airport or date-sweep expansion yet (a real, separate
 * scope decision: more API calls, more latency, more cost per request). */
export async function searchFlights(params: { origin: string; destination: string; date: string; tripType: "one_way" | "round_trip" }): Promise<FlightSearchResult> {
  assertToolAllowed("general", "web.search_fares");
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", params.origin);
  url.searchParams.set("arrival_id", params.destination);
  url.searchParams.set("outbound_date", params.date);
  url.searchParams.set("type", params.tripType === "one_way" ? "2" : "1");
  url.searchParams.set("currency", "USD");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", process.env.SERP_API ?? "");
  const response = await resilientFetch("serpapi_flights", url, {}, { timeoutMs: 10_000, maxAttempts: 2 });
  // `.status`/`.reason` ride along on the thrown error, not just baked into its message: reportFailure's describeError reads exactly
  // these two fields as safe to log (never the message, which can hold private data elsewhere) -- so a real failure here shows up in
  // logs as an actual HTTP status or SerpApi's own error string, not just "a fares search failed" with no way to tell why.
  if (!response.ok) throw Object.assign(new Error(`SERPAPI_FLIGHTS_${response.status}`), { status: response.status });
  const body = await response.json() as SerpApiResponse;
  if (body.error) throw Object.assign(new Error("SERPAPI_FLIGHTS_ERROR"), { reason: body.error.slice(0, 200) });
  const offers = [
    ...(body.best_flights ?? []).map((itinerary) => toOffer(itinerary, params.tripType, true)),
    ...(body.other_flights ?? []).map((itinerary) => toOffer(itinerary, params.tripType, false)),
  ].flatMap((offer) => offer ? [offer] : []).sort((a, b) => a.price - b.price);
  const insight = body.price_insights;
  const priceInsight: PriceInsight | null = insight ? {
    level: insight.price_level === "low" || insight.price_level === "high" || insight.price_level === "typical" ? insight.price_level : "unknown",
    lowestPrice: insight.lowest_price ?? null,
    typicalRange: insight.typical_price_range ?? null,
  } : null;
  return { offers, priceInsight, googleFlightsUrl: body.search_metadata?.google_flights_url ?? null };
}
