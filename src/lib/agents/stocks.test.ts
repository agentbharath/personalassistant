import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ quote: vi.fn(), publicSearch: vi.fn() }));
vi.mock("@/lib/tools/stocks/twelve-data", () => ({ fetchQuote: mocks.quote }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));

import { answerStock, buildStockCard } from "./stocks";

const quote = (over: object = {}) => ({
  symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", currency: "USD",
  price: 254.32, previousClose: 253.08, change: 1.24, percentChange: 0.49,
  dayLow: 251.90, dayHigh: 255.10, volume: 42815300, isMarketOpen: true,
  ...over,
});

beforeEach(() => { mocks.quote.mockReset(); mocks.publicSearch.mockReset().mockResolvedValue("fallback text"); });

describe("the stock card (free)", () => {
  it("shows the price, a real day range, and a signed change label for a gain", () => {
    const card = buildStockCard(quote());
    expect(card.eyebrow).toBe("AAPL · Apple Inc");
    expect(card.headline).toBe("$254.32");
    expect(card.changeLabel).toBe("+$1.24 (0.49%)");
    expect(card.changeDirection).toBe("up");
    expect(card.rangeLow).toBe(251.90);
    expect(card.rangeHigh).toBe(255.10);
    expect(card.current).toBe(254.32);
    expect(card.insight).toBe("Up 0.49% today.");
    expect(card.stats).toEqual([
      { label: "Prev close", value: "$253.08" },
      { label: "Volume", value: "42.8M" },
      { label: "Exchange", value: "NASDAQ" },
    ]);
  });

  it("signs a loss correctly and never claims a gain", () => {
    const card = buildStockCard(quote({ change: -3.10, percentChange: -1.21 }));
    expect(card.changeLabel).toBe("-$3.10 (1.21%)");
    expect(card.changeDirection).toBe("down");
    expect(card.insight).toBe("Down 1.21% today.");
  });

  it("says plainly when the market is closed", () => {
    const card = buildStockCard(quote({ isMarketOpen: false }));
    expect(card.insight).toContain("market is closed");
  });

  it("never invents an exchange or volume the quote didn't give", () => {
    const card = buildStockCard(quote({ exchange: "", volume: 500 }));
    expect(card.stats).toContainEqual({ label: "Exchange", value: "—" });
    expect(card.stats).toContainEqual({ label: "Volume", value: "500" });
  });
});

describe("answerStock (free)", () => {
  it("embeds a real quote as a card", async () => {
    mocks.quote.mockResolvedValue(quote());
    const answer = await answerStock("AAPL");
    expect(answer).toContain("```daylark-card");
    expect(answer).toContain("AAPL");
    expect(mocks.publicSearch).not.toHaveBeenCalled();
  });

  it("falls back to general search when the symbol isn't recognized, never inventing a price", async () => {
    mocks.quote.mockResolvedValue(null);
    const answer = await answerStock("NOTREAL");
    expect(answer).toBe("fallback text");
    expect(mocks.publicSearch).toHaveBeenCalledWith("NOTREAL stock price", undefined, "", undefined);
  });

  it("falls back to general search on a real failure, the same as weather and fares do", async () => {
    mocks.quote.mockRejectedValue(new Error("TWELVE_DATA_500"));
    const answer = await answerStock("AAPL");
    expect(answer).toBe("fallback text");
  });
});
