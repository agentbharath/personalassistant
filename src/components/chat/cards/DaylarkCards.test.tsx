import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CardChips, CardFooter, SportsEvent } from "./CardParts";
import { ScoreCard } from "./ScoreCard";
import type { ScoreCardPayload } from "@/lib/chat/card-payload";

it("keeps full follow-up text, limits pills to four, and outlines only one action", () => {
  const html = renderToStaticMarkup(<CardChips onFollowUp={() => {}} busy chips={[
    "Narrow it", { label: "Compare", text: "Compare the two jackets", purpose: "deeper" },
    { label: "Save my size", text: "Remember size M", purpose: "act" },
    { label: "Duplicate action", text: "Remember another size", purpose: "act" },
    { label: "More options", text: "Find more jackets", purpose: "widen" }, "Fifth pill",
  ]} />);
  expect(html.match(/<button/g)).toHaveLength(4);
  expect(html.match(/chipAct/g)).toHaveLength(1);
  expect(html).not.toContain("Duplicate action");
  expect(html).not.toContain("Fifth pill");
  expect(html.match(/disabled=""/g)).toHaveLength(4);
});

it("renders actual source domains as bare links", () => {
  const html = renderToStaticMarkup(<CardFooter limit="Availability may change." sources={[{ label: "A long article title", url: "https://www.rei.com/products/1" }]} />);
  expect(html).toContain(">rei.com</a>");
  expect(html).not.toContain("A long article title");
  expect(html).toContain("Availability may change.");
});

it("supports several competitors and multiple score cells without a sport-specific row layout", () => {
  const html = renderToStaticMarkup(<SportsEvent event={{ label: "Tennis · Final", tag: { label: "Final", tone: "neutral" }, outcome: "", sides: [
    { name: "Player A", score: "", cells: ["6", "4", "6"], rank: "1", detail: "Team A", lead: true },
    { name: "Player B", score: "", cells: ["3", "6", "2"], detail: "Team B", lead: false },
  ] }} />);
  expect(html).toContain("eventDone");
  expect(html.match(/class="[^"]*cell(?!s)[^"]*"/g)).toHaveLength(6);
  expect(html).toContain("leader");
});

const score: ScoreCardPayload = {
  kind: "score", match: "2nd ODI", status: { label: "Live", tone: "live" },
  teams: [{ name: "India", score: "200/2", detail: "30 ov", lead: true }, { name: "West Indies", score: "250", detail: "50 ov", lead: false }],
  outcome: { kind: "chase", text: "India need 51", detail: "", rates: ["CRR 6.67"] },
  thisOver: [{ label: "·", kind: "dot" }, { label: "4", kind: "boundary" }, { label: "W", kind: "wicket" }, { label: "", kind: "pending" }],
  tables: [{ title: "Batters", columns: ["Runs", "SR"], rows: [{ player: "A player", side: "India", stats: ["75", "120"], onStrike: true }] }],
  facts: [], sources: [], chips: [],
};
it("renders live balls and on-strike state only when supplied, and translates legacy status tones", () => {
  const html = renderToStaticMarkup(<ScoreCard payload={score} />);
  expect(html).toContain('aria-label="This over"');
  expect(html).toContain("ballBoundary");
  expect(html).toContain("ballWicket");
  expect(html).toContain("onStrike");
  const final = renderToStaticMarkup(<ScoreCard payload={{ ...score, status: { label: "Final", tone: "final" } }} />);
  expect(final).not.toContain('aria-label="This over"');
  expect(final).toContain("neutral");
});
