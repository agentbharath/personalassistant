import { describe, expect, it } from "vitest";
import { embedCard, extractCards, type StockCardPayload } from "./card-payload";

const stock = (symbol: string): StockCardPayload => ({
  kind: "stock", eyebrow: `${symbol} · ${symbol} Inc`, headline: "$100.00", changeLabel: "+$1.00 (1.00%)", changeDirection: "up",
  insight: "Up 1.00% today.", rangeLow: 99, rangeHigh: 101, current: 100, isMarketOpen: true,
  stats: [{ label: "Prev close", value: "$99.00" }, { label: "Volume", value: "1.0M" }, { label: "Exchange", value: "NASDAQ" }],
  attribution: "twelvedata.com · updated just now",
});

describe("extracting one or more cards from a message (free)", () => {
  it("extracts a single card exactly as before this was generalized", () => {
    const { text, segments } = extractCards(embedCard("NVDA is up.", stock("NVDA")));
    expect(text).toBe("NVDA is up.");
    expect(segments).toEqual([{ text: "NVDA is up.", card: stock("NVDA") }]);
  });

  it("returns the whole content as one plain-text segment when there's no card at all", () => {
    const { text, segments } = extractCards("Just a plain answer, no card.");
    expect(text).toBe("Just a plain answer, no card.");
    expect(segments).toEqual([{ text: "Just a plain answer, no card.", card: null }]);
  });

  it("extracts every card when several embedCard'ed answers are joined into one message (found live: dispatch.ts's own multi-query join, answers.join(\"\\n\\n---\\n\\n\"), left every card but the last one's raw JSON visible as literal text)", () => {
    const joined = [embedCard("NVDA · NVIDIA Corporation\n\n$228.86 up 1.68%.", stock("NVDA")), embedCard("MSFT · Microsoft Corporation\n\n$509.22 down 1.35%.", stock("MSFT"))].join("\n\n---\n\n");
    const { segments } = extractCards(joined);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ text: "NVDA · NVIDIA Corporation\n\n$228.86 up 1.68%.", card: stock("NVDA") });
    // The "---" divider dispatch.ts already joins with rides into the second segment's own leading text, rendering
    // as a plain markdown rule between the two cards rather than being lost.
    expect(segments[1].text).toBe("---\n\nMSFT · Microsoft Corporation\n\n$509.22 down 1.35%.");
    expect(segments[1].card).toEqual(stock("MSFT"));
    // No raw '{"kind":"stock"' JSON leaks into either segment's own text.
    for (const segment of segments) expect(segment.text).not.toContain('"kind"');
  });

  it("uses the prose fallback for a malformed card while preserving neighboring cards", () => {
    const bad = "First part.\n\n```daylark-card\nnot valid json\n```";
    const good = embedCard("Second part.", stock("AAPL"));
    const { segments } = extractCards(`${bad}\n\n---\n\n${good}`);
    expect(segments).toHaveLength(2);
    expect(segments[0].card).toBeNull();
    expect(segments[0].text).toBe("First part.");
    expect(segments[1].card).toEqual(stock("AAPL"));
  });
});

it("hides unknown card payloads and keeps their readable fallback", () => {
  const { text, segments } = extractCards('Saved answer.\n\n```daylark-card\n{"kind":"future-card","internal":"secret implementation"}\n```');
  expect(text).toBe("Saved answer.");
  expect(segments).toEqual([{ text: "Saved answer.", card: null }]);
  expect(extractCards('```daylark-card\n{"kind":"future-card"}\n```').text).toBe("This saved card couldn't be displayed.");
});
