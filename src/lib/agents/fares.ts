import { Temporal } from "@js-temporal/polyfill";
import { askAboutTime } from "./calendar";
import { TIME_UNAVAILABLE } from "./time-interpreter";
import { extractFlightSlotsForUser } from "./flight-query-runtime";
import { searchFlights, type FareOffer } from "@/lib/tools/general/serpapi-flights";
import { plain } from "./search-answer";
import { loadLearnings } from "@/lib/learning/store";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { reportFailure } from "@/lib/observability/report";

/** A light, honest tiebreaker for ranking, not a fabricated fee: a stop costs real time and hassle beyond its ticket price, so two offers
 * a few dollars apart are ranked by more than the bare fare. No baggage-fee modeling (R32 v1): SerpApi's Google Flights response here
 * doesn't reliably give a checked-bag fee to add, and guessing one would be exactly the kind of invented number this whole fix exists to
 * avoid. */
function effectivePrice(offer: FareOffer) {
  return offer.price + offer.stops * 15;
}

function formatTime(value: string) {
  const match = value.match(/(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[2]);
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${match[3]} ${period}`;
}

function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDateLabel(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return value;
  try { return Temporal.PlainDate.from(match[1]).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return match[1]; }
}

function googleFlightsFallbackLink(origin: string, destination: string, date: string) {
  const url = new URL("https://www.google.com/travel/flights");
  url.searchParams.set("q", `Flights from ${origin} to ${destination} on ${date}`);
  return url.toString();
}

/** Real flight offers from a live source (SerpApi's Google Flights engine), replacing Tavily's aggregator-page guesswork for a fares
 * request (R32): every number here — price, times, stops — is rendered directly from the API response, in code, with no model in the
 * loop to misread or invent one. On a failed or empty search, an honest failure and a real Google Flights link — never a fallback to
 * search-snippet numbers, which is exactly the confident-wrong-data problem this replaces. */
export async function answerFlightFares(query: string, today: string, userId: string): Promise<string> {
  const homeLocation = (await loadLearnings(userId).catch(() => NO_LEARNINGS)).homeLocation ?? null;
  const outcome = await extractFlightSlotsForUser(query, homeLocation, today, userId);
  if (outcome.kind === "unavailable") return TIME_UNAVAILABLE;
  if (outcome.kind === "ask") return askAboutTime(outcome.question, outcome.choices);
  const { slots } = outcome;

  let result;
  try {
    result = await searchFlights({ origin: slots.origin, destination: slots.destination, date: slots.date, tripType: slots.tripType });
  } catch (error) {
    // A flight-search error never carries anything personal (an HTTP status, SerpApi's own error string, a route/date already visible
    // in the URL) -- unlike reportFailure's blanket policy elsewhere, so the full message/stack goes straight to console here, not just
    // the scrubbed name+status. Sentry's own account may be unavailable (a free trial, a bad token); this never depends on it.
    console.error("flight_search_failed", JSON.stringify({ origin: slots.origin, destination: slots.destination, date: slots.date, tripType: slots.tripType }), error instanceof Error ? error.stack ?? error.message : error);
    reportFailure("flight_search_failed", error);
    return `I couldn't get live fares right now. Try [Google Flights](${googleFlightsFallbackLink(slots.origin, slots.destination, slots.date)}) directly for ${slots.origin} to ${slots.destination}.`;
  }
  if (!result.offers.length) {
    return `No fares came back for ${slots.origin} to ${slots.destination} on ${slots.date}. Try [Google Flights](${googleFlightsFallbackLink(slots.origin, slots.destination, slots.date)}) directly, or a different date.`;
  }

  const ranked = [...result.offers].sort((a, b) => effectivePrice(a) - effectivePrice(b)).slice(0, 5);
  const cheapest = ranked[0];
  const tripLabel = slots.tripType === "round_trip" ? "round-trip" : "one-way";
  const lines: string[] = [
    `**Cheapest real option:** ${slots.destination} on ${plain(cheapest.airline, 30) || "an unlisted airline"}, ${formatDateLabel(cheapest.departAt)}, $${cheapest.price} ${tripLabel}${cheapest.stops === 0 ? ", nonstop" : `, ${cheapest.stops} stop${cheapest.stops > 1 ? "s" : ""}`}.`,
  ];

  const assumptions: string[] = [];
  if (slots.dateStatus === "assumed") assumptions.push(`no date given — showing ${slots.date}`);
  if (slots.tripTypeStatus === "assumed") assumptions.push("one-way (not stated)");
  if (assumptions.length) lines.push(`*Assumed: ${assumptions.join("; ")}.*`);

  const rows = ranked.map((offer) => `| ${plain(offer.airline, 30) || "airline not listed"} | $${offer.price} | ${formatTime(offer.departAt)} → ${formatTime(offer.arriveAt)} | ${offer.stops === 0 ? "nonstop" : `${offer.stops} stop${offer.stops > 1 ? "s" : ""}`} | ${formatDuration(offer.durationMin)} |`);
  lines.push(["| Airline | Price | Times | Stops | Duration |", "|---|---|---|---|---|", ...rows].join("\n"));

  if (result.priceInsight && result.priceInsight.level !== "unknown" && result.priceInsight.typicalRange) {
    const { level, lowestPrice, typicalRange } = result.priceInsight;
    const levelWord = level === "low" ? "low" : level === "high" ? "high" : "typical";
    lines.push(`*${lowestPrice ? `$${lowestPrice} is ${levelWord} for this route` : "Price check"}; typical range is $${typicalRange[0]}–${typicalRange[1]}.*`);
  }
  if (result.googleFlightsUrl) lines.push(`[See more on Google Flights](${result.googleFlightsUrl})`);

  return lines.join("\n\n");
}
