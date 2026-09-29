import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";
import { fetchQuote } from "./twelve-data";

const quoteBody = (over: object = {}) => ({
  symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", currency: "USD",
  close: "254.32", previous_close: "253.08", change: "1.24", percent_change: "0.49",
  low: "251.90", high: "255.10", volume: "42815300", is_market_open: true,
  ...over,
});

beforeEach(() => { process.env.TWELVE_DATA_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); delete process.env.TWELVE_DATA_API_KEY; });

describe("Twelve Data quote provider contract", () => {
  it("sends the symbol and key, and parses every field into a real quote", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(quoteBody()), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const quote = await fetchQuote("AAPL");
    const [url] = providerFetch.mock.calls[0] as [URL];
    expect(url.toString()).toContain("symbol=AAPL");
    expect(url.toString()).toContain("apikey=test-key");
    expect(quote).toEqual({
      symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", currency: "USD",
      price: 254.32, previousClose: 253.08, change: 1.24, percentChange: 0.49,
      dayLow: 251.90, dayHigh: 255.10, volume: 42815300, isMarketOpen: true,
    });
  });

  it("returns null for an unrecognized symbol, Twelve Data's own error shape rather than a transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 400, message: "symbol not found", status: "error" }), { status: 200 })));
    expect(await fetchQuote("NOTREAL")).toBeNull();
  });

  it("throws on a real HTTP failure, so a real outage never silently renders as an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(fetchQuote("AAPL")).rejects.toThrow("TWELVE_DATA_500");
  });

  it("returns null when no API key is configured yet, instead of sending an unauthenticated request", async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    expect(await fetchQuote("AAPL")).toBeNull();
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
