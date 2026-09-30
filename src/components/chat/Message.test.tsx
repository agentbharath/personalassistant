import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMessage, UserMessage } from "./Message";
import { embedCard, type SpendingCardPayload, type SportsCardPayload, type StockCardPayload, type SuggestionCardPayload } from "@/lib/chat/card-payload";

describe("the buttons under your own message (free)", () => {
  it("offers Copy and Ask again", () => {
    const html = renderToStaticMarkup(<UserMessage onResend={() => undefined}>suggest some chinese cuisines near me</UserMessage>);
    expect(html).toContain("suggest some chinese cuisines near me");
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('aria-label="Ask again"');
  });

  it("leaves out Ask again when there is nothing to send it with, and disables it while Daylark is busy", () => {
    expect(renderToStaticMarkup(<UserMessage>hi</UserMessage>)).not.toContain("Ask again");
    expect(renderToStaticMarkup(<UserMessage busy onResend={() => undefined}>hi</UserMessage>)).toMatch(/aria-label="Ask again"[^>]*disabled|disabled[^>]*aria-label="Ask again"/);
  });
});

describe("a message carrying a card payload (free)", () => {
  const payload: SpendingCardPayload = {
    kind: "spending", periodLabel: "2026-09-01–2026-09-30", filterLabel: "restaurants", currency: "USD",
    total: 19600, priorTotal: 17500, changePercent: 12, comparisonLabel: "vs last month", insight: "Up 12% from the prior period.",
    running: [{ current: 0, prior: 0 }, { current: 19600, prior: 17500 }],
    xTicks: [{ offset: 0, label: "Sep 1" }, { offset: 1, label: "Sep 2" }],
    changes: [{ category: "restaurants", now: 19600, before: 17500, delta: 2100 }],
    topMerchants: [{ merchant: "DoorDash", amountMinor: 19600, count: 1 }], categories: [],
    actions: [{ label: "Compare to last month", query: "compare this to last month" }],
    count: 1, otherCurrencyCount: 0,
  };

  it("renders the rich card instead of markdown, and never leaks the raw JSON fence into the page", () => {
    const content = embedCard("### Spending · 2026-09-01–2026-09-30\n\n$196.00", payload);
    const html = renderToStaticMarkup(<AssistantMessage>{content}</AssistantMessage>);
    expect(html).toContain("$196.00");
    expect(html).toContain("Up 12% from the prior period");
    expect(html).toContain("Restaurants");
    expect(html).not.toContain("daylark-card");
    expect(html).not.toContain("```");
  });

  it("falls back to plain markdown when the content has no card fence", () => {
    const html = renderToStaticMarkup(<AssistantMessage>Just a plain answer.</AssistantMessage>);
    expect(html).toContain("Just a plain answer.");
  });

  it("falls back to plain markdown, fence and all, when the payload doesn't parse as a recognized card", () => {
    const broken = "An answer.\n\n```daylark-card\nnot valid json\n```";
    const html = renderToStaticMarkup(<AssistantMessage>{broken}</AssistantMessage>);
    expect(html).toContain("An answer.");
  });

  it("renders every card as its own real card, none leaked as raw JSON text, when a multi-query answer joins two cards into one message (found live: only the last of several stock lookups rendered as a card, the rest showed as literal '{\"kind\":\"stock\",...}' text)", () => {
    const stock = (symbol: string, price: string): StockCardPayload => ({
      kind: "stock", eyebrow: `${symbol} · ${symbol} Inc`, headline: price, changeLabel: "+$1.00 (1.00%)", changeDirection: "up",
      insight: "Up 1.00% today.", rangeLow: 99, rangeHigh: 101, current: 100, isMarketOpen: true,
      stats: [{ label: "Prev close", value: "$99.00" }, { label: "Volume", value: "1.0M" }, { label: "Exchange", value: "NASDAQ" }],
      attribution: "twelvedata.com · updated just now",
    });
    const joined = [embedCard("NVDA · NVIDIA Corporation", stock("NVDA", "$228.86")), embedCard("MSFT · Microsoft Corporation", stock("MSFT", "$509.22"))].join("\n\n---\n\n");
    const html = renderToStaticMarkup(<AssistantMessage>{joined}</AssistantMessage>);
    expect(html).toContain("$228.86");
    expect(html).toContain("$509.22");
    expect(html).not.toContain("daylark-card");
    expect(html).not.toContain('"kind":"stock"');
  });

  it("renders a sports card instead of markdown, and never leaks the raw JSON fence into the page", () => {
    const sports: SportsCardPayload = {
      kind: "sports", kindLabel: "NFL score", freshness: "", summary: "Record: 3-0",
      eventLabel: "NFL · vs Arizona Cardinals", statusTag: { label: "Final", tone: "neutral" },
      event: { final: true, sides: [
        { name: "Arizona Cardinals", score: "30", detail: "", winner: false },
        { name: "San Francisco 49ers", score: "36", detail: "", winner: true },
      ], outcome: "San Francisco 49ers won by 6." },
      upcoming: null, attribution: "espn.com",
    };
    const html = renderToStaticMarkup(<AssistantMessage>{embedCard("### NFL score\n\n36-30", sports)}</AssistantMessage>);
    expect(html).toContain("36");
    expect(html).toContain("San Francisco 49ers won by 6");
    expect(html).not.toContain("daylark-card");
    expect(html).not.toContain('"kind":"sports"');
  });

  it("renders a suggestion card instead of markdown, and never leaks the raw JSON fence into the page", () => {
    const suggestion: SuggestionCardPayload = {
      kind: "suggestion", kindLabel: "Men's fleece jackets, size M", freshness: "Just now",
      topPick: { name: "Cotopaxi Abrazo", meta: "REI · Medium weight · 4.7 (135)", metric: "$74.83", edgeTag: { label: "44-50% off", tone: "good" }, reason: "Biggest real discount among well-reviewed jackets.", actionLabel: "View at rei.com", actionUrl: "https://rei.com/1" },
      rows: [{ name: "REI Trailmade", meta: "REI · Heavier, tall sizes · 4.6", metric: "$69.95", roleTag: { label: "Cheapest solid", tone: "highlight" } }],
      limit: "Coupons, member prices and cashback aren't included.",
      sources: [{ label: "rei.com", url: "https://rei.com/1" }],
      chips: ["Under $40", "Are they good?"],
    };
    const html = renderToStaticMarkup(<AssistantMessage>{embedCard("### Men's fleece jackets, size M\n\nCotopaxi Abrazo", suggestion)}</AssistantMessage>);
    expect(html).toContain("Cotopaxi Abrazo");
    expect(html).toContain("REI Trailmade");
    expect(html).not.toContain("daylark-card");
    expect(html).not.toContain('"kind":"suggestion"');
  });
});
