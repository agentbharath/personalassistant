import { embedCard, type StockCardPayload } from "@/lib/chat/card-payload";
import { fetchQuote, type Quote } from "@/lib/tools/stocks/twelve-data";
import { answerPublicSearch } from "./general";

const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
const volumeLabel = (volume: number) => volume >= 1_000_000 ? `${(volume / 1_000_000).toFixed(1)}M` : volume >= 1_000 ? `${(volume / 1_000).toFixed(1)}K` : String(volume);

/** Every number here comes straight from the quote, no model in the loop -- the same reasoning R32 already applied to places, fares and
 * weather. Day range and change are Twelve Data's own fields, not derived. */
export function buildStockCard(quote: Quote): StockCardPayload {
  const direction = quote.change > 0 ? "up" : quote.change < 0 ? "down" : "flat";
  const sign = quote.change > 0 ? "+" : quote.change < 0 ? "-" : "";
  const changeLabel = `${sign}${money(Math.abs(quote.change), quote.currency)} (${Math.abs(quote.percentChange).toFixed(2)}%)`;
  const verb = direction === "up" ? "Up" : direction === "down" ? "Down" : "Flat on";
  return {
    kind: "stock",
    eyebrow: `${quote.symbol} · ${quote.name}`,
    headline: money(quote.price, quote.currency),
    changeLabel,
    changeDirection: direction,
    insight: `${verb} ${Math.abs(quote.percentChange).toFixed(2)}% today${quote.isMarketOpen ? "." : "; market is closed."}`,
    rangeLow: quote.dayLow,
    rangeHigh: quote.dayHigh,
    current: quote.price,
    isMarketOpen: quote.isMarketOpen,
    stats: [
      { label: "Prev close", value: money(quote.previousClose, quote.currency) },
      { label: "Volume", value: volumeLabel(quote.volume) },
      { label: "Exchange", value: quote.exchange || "—" },
    ],
    attribution: "twelvedata.com · updated just now",
  };
}

function renderStockText(card: StockCardPayload): string {
  return `### ${card.eyebrow}\n\n${card.headline} ${card.changeLabel}\n\n${card.insight}`;
}

/**
 * A real quote from Twelve Data (R45: the same reasoning already applied to places, fares and weather -- a search snippet is not a
 * substitute for a source that actually has the data). `query` is the ticker symbol the router already resolved from a company name
 * ("Apple" -> "AAPL"), the same real-world-knowledge resolution it already does for an airport code. Falls back to the existing
 * Tavily-backed general search on any failure -- a plain, if less structured, answer beats nothing.
 */
export async function answerStock(query: string, memoryContext = "", today?: string): Promise<string> {
  try {
    const quote = await fetchQuote(query);
    if (!quote) return answerPublicSearch(`${query} stock price`, undefined, memoryContext, today);
    const card = buildStockCard(quote);
    return embedCard(renderStockText(card), card);
  } catch {
    return answerPublicSearch(`${query} stock price`, undefined, memoryContext, today);
  }
}
