import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type PlaceResult = {
  name: string;
  address: string;
  rating: number | null;
  priceLevel: "inexpensive" | "moderate" | "expensive" | "very_expensive" | null;
  openNow: boolean | null;
  mapsUri: string | null;
};

const PRICE_LEVEL: Record<string, PlaceResult["priceLevel"]> = {
  PRICE_LEVEL_INEXPENSIVE: "inexpensive",
  PRICE_LEVEL_MODERATE: "moderate",
  PRICE_LEVEL_EXPENSIVE: "expensive",
  PRICE_LEVEL_VERY_EXPENSIVE: "very_expensive",
};

type PlacesResponse = { places?: Array<{
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
}> };

/** Real place data (hours, rating, price level) from Google Places API (New), replacing a Tavily snippet's guesswork for the `places`
 * kind (R32, 2026-09-26): code renders these fields directly, with no model in the loop to misread or invent them. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  assertToolAllowed("general", "web.search_places");
  const response = await resilientFetch("google_places", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": process.env.PLACES_API ?? "",
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.currentOpeningHours.openNow,places.googleMapsUri",
    },
    body: JSON.stringify({ textQuery: query }),
  }, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) throw new Error(`GOOGLE_PLACES_${response.status}`);
  const body = await response.json() as PlacesResponse;
  return (body.places ?? []).flatMap((place) => place.displayName?.text ? [{
    name: place.displayName.text,
    address: place.formattedAddress ?? "",
    rating: typeof place.rating === "number" ? place.rating : null,
    priceLevel: place.priceLevel ? PRICE_LEVEL[place.priceLevel] ?? null : null,
    openNow: place.currentOpeningHours?.openNow ?? null,
    mapsUri: place.googleMapsUri ?? null,
  }] : []);
}
