import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown receipt rows", () => {
  it("shows the amount and date on the right for Daylark's receipt rows", () => {
    const html = renderToStaticMarkup(<Markdown>{"1. **Order Confirmed #947**  \n   $48.20 · Sep 15\n2. **Order Confirmed #946**  \n   $12.99 · Sep 3"}</Markdown>);
    expect(html.match(/_receipt_/g)?.length).toBe(2);
    expect(html).toContain("$48.20");
    expect(html).toContain("<small>Sep 15</small>");
  });

  it("leaves ordinary list items alone", () => {
    const html = renderToStaticMarkup(<Markdown>{"1. **Lunch** was fine\n2. Nothing here"}</Markdown>);
    expect(html).not.toContain("_receipt_");
  });

  it("marks an italic-only paragraph as a footnote", () => {
    expect(renderToStaticMarkup(<Markdown>{"*Searched the last 30 days.*"}</Markdown>)).toContain("meta");
  });
});
