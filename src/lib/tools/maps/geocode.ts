export type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{ address_components?: Array<{ long_name: string; short_name: string; types: string[] }> }>;
};

/** "Oakland, CA" for a US place, "Toronto, ON, Canada" elsewhere. Null when the response holds no city. */
export function placeLabel(response: GeocodeResponse): string | null {
  for (const result of response.results ?? []) {
    const parts = result.address_components ?? [];
    const find = (type: string) => parts.find((part) => part.types.includes(type));
    const city = find("locality") ?? find("postal_town") ?? find("sublocality") ?? find("administrative_area_level_2");
    if (!city) continue;
    const region = find("administrative_area_level_1");
    const country = find("country");
    const inUnitedStates = country?.short_name === "US";
    return [city.long_name, region?.short_name, inUnitedStates ? null : country?.long_name].filter(Boolean).join(", ");
  }
  return null;
}

/** The API is turned off, or this key is not allowed to call it. Distinct from "no result" so the user sees the right message. */
export class GeocodingUnavailableError extends Error {}

/** Turns coordinates into a city name, once, at the user's request. The coordinates are not stored anywhere. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("result_type", "locality|postal_town|sublocality");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY ?? "");
  const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new GeocodingUnavailableError(`GEOCODE_HTTP_${response.status}`);
  const body = await response.json() as GeocodeResponse;
  if (body.status === "REQUEST_DENIED" || body.status === "OVER_QUERY_LIMIT" || body.status === "OVER_DAILY_LIMIT") throw new GeocodingUnavailableError(body.status);
  return body.status === "OK" ? placeLabel(body) : null;
}
