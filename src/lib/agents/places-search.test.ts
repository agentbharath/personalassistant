import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), fallback: vi.fn() }));
vi.mock("@/lib/tools/general/google-places", () => ({ searchPlaces: mocks.search }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.fallback }));

import { answerPlacesSearch } from "./places-search";

beforeEach(() => { mocks.search.mockReset(); mocks.fallback.mockReset().mockResolvedValue("TAVILY FALLBACK"); });

const place = (over: object = {}) => ({ name: "Ginger Cafe", address: "747 S. Wolfe Road", rating: 4.3, priceLevel: "moderate" as const, openNow: true, mapsUri: "https://maps.google.com/x", ...over });

describe("real place data, replacing search-snippet guesses (R32)", () => {
  it("renders real hours, rating and price level directly from the API, with no model in the loop", async () => {
    mocks.search.mockResolvedValue([place()]);
    const answer = await answerPlacesSearch("sushi in Sunnyvale, CA");
    expect(answer).toContain("**Ginger Cafe** — ★4.3 · $$ · open now");
    expect(answer).toContain("747 S. Wolfe Road · [Open in Maps](https://maps.google.com/x)");
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it("remembers the places shown, so a follow-up can point at them", async () => {
    mocks.search.mockResolvedValue([place()]);
    const remember = vi.fn().mockResolvedValue(undefined);
    await answerPlacesSearch("sushi in Sunnyvale, CA", remember);
    expect(remember).toHaveBeenCalledWith({ query: "sushi in Sunnyvale, CA", places: [{ name: "Ginger Cafe", address: "747 S. Wolfe Road", note: "" }] });
  });

  it("falls back to the existing Tavily search, not to nothing, when the API call fails", async () => {
    mocks.search.mockRejectedValue(new Error("GOOGLE_PLACES_500"));
    expect(await answerPlacesSearch("sushi in Sunnyvale, CA")).toBe("TAVILY FALLBACK");
  });

  it("falls back to Tavily when the API returns no usable places", async () => {
    mocks.search.mockResolvedValue([]);
    expect(await answerPlacesSearch("x")).toBe("TAVILY FALLBACK");
  });
});
