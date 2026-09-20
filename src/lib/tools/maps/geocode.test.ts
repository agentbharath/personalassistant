import { afterEach, describe, expect, it, vi } from "vitest";
import { GeocodingUnavailableError, placeLabel, reverseGeocode } from "./geocode";

const component = (long: string, short: string, ...types: string[]) => ({ long_name: long, short_name: short, types });

describe("naming the city from a geocoding response", () => {
  it("gives City, ST for a US place", () => {
    expect(placeLabel({ results: [{ address_components: [component("Oakland", "Oakland", "locality", "political"), component("Alameda County", "Alameda County", "administrative_area_level_2"), component("California", "CA", "administrative_area_level_1"), component("United States", "US", "country")] }] })).toBe("Oakland, CA");
  });
  it("adds the country outside the US", () => {
    expect(placeLabel({ results: [{ address_components: [component("Toronto", "Toronto", "locality"), component("Ontario", "ON", "administrative_area_level_1"), component("Canada", "CA", "country")] }] })).toBe("Toronto, ON, Canada");
  });
  it("falls back to a postal town or sublocality, and returns null when there is no city", () => {
    expect(placeLabel({ results: [{ address_components: [component("Richmond", "Richmond", "postal_town"), component("England", "England", "administrative_area_level_1"), component("United Kingdom", "GB", "country")] }] })).toBe("Richmond, England, United Kingdom");
    expect(placeLabel({ results: [{ address_components: [component("United States", "US", "country")] }] })).toBeNull();
    expect(placeLabel({})).toBeNull();
  });
});

describe("reverse geocoding", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("returns the city when Google answers", async () => {
    respond({ status: "OK", results: [{ address_components: [component("Oakland", "Oakland", "locality"), component("California", "CA", "administrative_area_level_1"), component("United States", "US", "country")] }] });
    expect(await reverseGeocode(37.8, -122.27)).toBe("Oakland, CA");
  });
  it("returns null when nothing is found", async () => {
    respond({ status: "ZERO_RESULTS", results: [] });
    expect(await reverseGeocode(0, 0)).toBeNull();
  });
  it("reports a turned-off API as unavailable, not as no result", async () => {
    respond({ status: "REQUEST_DENIED", error_message: "This API is not activated" });
    await expect(reverseGeocode(37.8, -122.27)).rejects.toBeInstanceOf(GeocodingUnavailableError);
  });
});
