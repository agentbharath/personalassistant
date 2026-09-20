import { describe, expect, it } from "vitest";
import { SEARCH_ANSWER_JSON_SCHEMA, mapsLink, placeContext, plain, renderSearchAnswer } from "./search-answer";

describe("the search answer (free)", () => {
  it("has no union-typed parameters, so structured outputs accept it", () => {
    expect(JSON.stringify(SEARCH_ANSWER_JSON_SCHEMA)).not.toMatch(/anyOf|oneOf|"type":\[/);
  });

  it("strips anything from web text that could become a link, emphasis or a new line inside a card", () => {
    expect(plain("Bad **Name** [click](https://evil.example)\nnext line")).toBe("Bad Name clickhttps://evil.example next line");
    expect(plain("x".repeat(500), 20)).toHaveLength(20);
  });

  it("reads the town out of the search, to point a Maps search at the right place", () => {
    expect(placeContext("Chinese restaurants in Sunnyvale, CA")).toBe("Sunnyvale, CA");
    expect(placeContext("best pizza near Oakland")).toBe("Oakland");
    expect(placeContext("who won the world series")).toBe("");
  });

  it("builds the Maps link itself, from the name and the address or town", () => {
    expect(mapsLink("Ginger Cafe", "", "Chinese restaurants in Sunnyvale, CA")).toBe("https://www.google.com/maps/search/?api=1&query=Ginger+Cafe+Sunnyvale%2C+CA");
    expect(mapsLink("Asia Village", "747 S. Wolfe Road", "x")).toContain("Asia+Village+747+S.+Wolfe+Road");
  });

  it("uses at most five cards, skips a nameless one, and cites only real sources", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ name: index === 1 ? "" : `Place ${index}`, address: "", note: "n", source: index === 0 ? 9 : 2 }));
    const text = renderSearchAnswer({ kind: "places", intro: "List:", items, answer: "", caveat: "Hours vary." }, "q in Town", 3);
    expect(text.match(/^- \*\*/gm)).toHaveLength(4);
    expect(text).not.toContain("[9]");
    expect(text).toContain("*Hours vary.*");
  });

  it("falls back to a plain answer when a places answer has no usable places", () => {
    expect(renderSearchAnswer({ kind: "places", intro: "Nothing.", items: [], answer: "No results.", caveat: "" }, "q", 3)).toBe("Nothing.\n\nNo results.");
  });
});
