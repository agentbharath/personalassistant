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
  const body = await response.json().catch(() => null) as QuoteResponse | null;
  // Twelve Data reports "no such symbol" as its own structured error (status:"error") -- sometimes under a 200, but found live: an
  // outright invalid symbol comes back under a real HTTP 404, which used to throw here before this body was ever read. Read the body
  // first, regardless of HTTP status, rather than treating every non-200 as a transport failure. A real auth/quota problem (401/403/429)
  // still throws: a bad or expired key is a misconfiguration to surface, not a symbol to quietly shrug off as unrecognized.
  if (body?.status === "error") {
    if (response.status === 401 || response.status === 403 || response.status === 429) throw new Error(`TWELVE_DATA_${response.status}`);
    return null;
  }
  if (!response.ok || !body) throw new Error(`TWELVE_DATA_${response.status}`);
  if (!body.symbol || body.close === undefined) return null;
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
