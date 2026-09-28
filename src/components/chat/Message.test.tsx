import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMessage, UserMessage } from "./Message";
import { embedCard, type SpendingCardPayload } from "@/lib/chat/card-payload";

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
});
