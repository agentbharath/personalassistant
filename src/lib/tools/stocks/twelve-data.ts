import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type Quote = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  previousClose: number;
  change: number;
  percentChange: number;
  dayLow: number;
  dayHigh: number;
  volume: number;
  isMarketOpen: boolean;
};

type QuoteResponse = {
  symbol?: string; name?: string; exchange?: string; currency?: string;
  close?: string; previous_close?: string; change?: string; percent_change?: string;
  low?: string; high?: string; volume?: string; is_market_open?: boolean;
  code?: number; status?: string; message?: string;
};

/**
 * A real quote from Twelve Data's free tier (real-time US equities, 800 requests/day, no credit card -- decided by the owner, 2026-09-28,
 * over the several other free options surveyed: Stooq's long-used keyless CSV endpoint no longer resolves at all, live-checked before
 * ruling it out, and an unofficial scraped endpoint isn't something to build a feature on). Every number here comes straight from the API
 * response, no model in the loop, the same reasoning R32 already applied to places, fares and weather. Null when the symbol isn't a real
 * one Twelve Data recognizes, or the key isn't configured yet.
 */
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  assertToolAllowed("general", "web.search_stocks");
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;
  const url = new URL("https://api.twelvedata.com/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);
  const response = await resilientFetch("twelve_data", url, {}, { timeoutMs: 8_000, maxAttempts: 2 });
  if (!response.ok) throw new Error(`TWELVE_DATA_${response.status}`);
  const body = await response.json() as QuoteResponse;
  // An unrecognized symbol or a bad key comes back 200 OK with status:"error", not a 4xx -- Twelve Data's own error shape, not a transport
  // failure, so it's read here rather than left to throw on a missing field below.
  if (body.status === "error" || !body.symbol || body.close === undefined) return null;
  const price = Number(body.close);
  if (!Number.isFinite(price)) return null;
  return {
    symbol: body.symbol,
    name: body.name ?? body.symbol,
    exchange: body.exchange ?? "",
    currency: body.currency ?? "USD",
    price,
    previousClose: Number(body.previous_close ?? price),
    change: Number(body.change ?? 0),
    percentChange: Number(body.percent_change ?? 0),
    dayLow: Number(body.low ?? price),
    dayHigh: Number(body.high ?? price),
    volume: Number(body.volume ?? 0),
    isMarketOpen: body.is_market_open === true,
  };
}
