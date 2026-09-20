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

describe("Markdown place cards", () => {
  const list = "- **Ginger Cafe** — Chinese with Southeast Asian influences [1]  \n  [Open in Maps](https://www.google.com/maps/search/?api=1&query=Ginger+Cafe)\n- **Asia Village** — pickup or delivery [4]  \n  747 S. Wolfe Road · [Open in Maps](https://www.google.com/maps/search/?api=1&query=Asia+Village)";

  it("shows a list of places as cards with the name, the note, the address and a Maps link", () => {
    const html = renderToStaticMarkup(<Markdown>{list}</Markdown>);
    expect(html.match(/_card_/g)?.length).toBe(2);
    expect(html).toContain("Ginger Cafe");
    expect(html).toContain("Chinese with Southeast Asian influences");
    expect(html).toContain("747 S. Wolfe Road");
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=Asia+Village"');
    expect(html).toContain("Open in Maps");
    expect(html).not.toContain("<ul>");
  });

  it("leaves an ordinary list alone, even one with a Maps link, unless every item has the card shape", () => {
    expect(renderToStaticMarkup(<Markdown>{"- one\n- two"}</Markdown>)).toContain("<ul>");
    const mixed = renderToStaticMarkup(<Markdown>{`${list}\n- just a note`}</Markdown>);
    expect(mixed).toContain("<ul>");
    expect(mixed).not.toContain("_card_");
  });

  it("does not make a card out of a link that is not to Google Maps", () => {
    const html = renderToStaticMarkup(<Markdown>{"- **A** — x  \n  [Open](https://evil.example/)\n- **B** — y  \n  [Open](https://evil.example/)"}</Markdown>);
    expect(html).not.toContain("_card_");
  });
});
