import { searchPlaces } from "@/lib/tools/general/google-places";
import { mapsLink, plain } from "./search-answer";
import { answerPublicSearch, type RememberSearch } from "./general";
import { reportFailure } from "@/lib/observability/report";

const PRICE_LABEL: Record<string, string> = { inexpensive: "$", moderate: "$$", expensive: "$$$", very_expensive: "$$$$" };

/** Real place data (hours, rating, price level) from Google Places API (New), replacing Tavily's aggregator-snippet guesswork for a places
 * request (R32): rendered directly from the API response, in code — no model in the loop to misread or invent an hour or a rating. Known,
 * accepted tradeoff for v1: this path does not apply R31 memory-based personalization (a hard dietary fact narrowing a product pick) —
 * that matters most for a single product/pick recommendation, which stays on the existing Tavily path (the `answer` kind) unaffected by
 * this change; a venue listing was never doing blanket exclusion at the restaurant level in the first place. Falls back to the existing
 * Tavily-based search, not to nothing, if the API call itself fails. */
export async function answerPlacesSearch(query: string, remember?: RememberSearch, memoryContext = ""): Promise<string> {
  try {
    const places = await searchPlaces(query);
    const cards = places.slice(0, 5).map((place) => {
      const name = plain(place.name, 80);
      if (!name) return "";
      const address = plain(place.address, 120);
      const bits = [
        place.rating ? `★${place.rating}` : null,
        place.priceLevel ? PRICE_LABEL[place.priceLevel] : null,
        place.openNow === true ? "open now" : place.openNow === false ? "closed now" : null,
      ].filter((bit): bit is string => Boolean(bit));
      return `- **${name}**${bits.length ? ` — ${bits.join(" · ")}` : ""}  \n  ${address ? `${address} · ` : ""}[Open in Maps](${place.mapsUri || mapsLink(name, address, query)})`;
    }).filter(Boolean);
    if (cards.length) {
      if (remember) await remember({ query, places: places.slice(0, 5).map((place) => ({ name: plain(place.name, 80), address: plain(place.address, 120), note: "" })) }).catch(() => undefined);
      return cards.join("\n");
    }
  } catch (error) {
    reportFailure("places_search_failed", error);
  }
  return answerPublicSearch(query, remember, memoryContext);
}
