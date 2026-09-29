import { z } from "zod";

/**
 * A web search answer as structured data. The model fills it in from the search evidence; code turns it into the reply, so the shape of the
 * reply and every link in it are decided here, not by text from the web.
 */
const fareRowSchema = z.object({
  airline: z.string(), price: z.string(),
  priceBasis: z.enum(["one_way", "round_trip", "unspecified"]),
  stops: z.enum(["nonstop", "one_stop", "two_plus_stops", "unspecified"]),
  note: z.string(), source: z.number(),
});
export const searchAnswerSchema = z.object({
  kind: z.enum(["places", "answer", "fares"]),
  intro: z.string(),
  items: z.array(z.object({ name: z.string(), address: z.string(), note: z.string(), source: z.number() })),
  /** kind "fares" only. A flat sibling field, not nested per kind, for the same reason `items` already is: the API's structured-output
   * schema is one fixed shape, so every kind's fields are always present and simply empty when unused. */
  fares: z.array(fareRowSchema),
  answer: z.string(),
  caveat: z.string(),
  /** R43: the model's own read of whether this evidence actually supports an answer, not a separate judgment call before this one --
   * the common case (evidence already answers it) pays no extra latency; only `sufficient: false` triggers one more search round, in
   * general.ts, using missingQuery. True whenever answer/items/fares reflect real evidence, even an honest partial one. */
  sufficient: z.boolean(),
  /** A sharper, more specific search query targeting exactly the missing fact (a year, a trim, a location) -- never a repeat of the
   * original query. "" whenever sufficient is true. */
  missingQuery: z.string(),
});
export type SearchAnswer = z.infer<typeof searchAnswerSchema>;
export type FareRow = z.infer<typeof fareRowSchema>;

export const SEARCH_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["places", "answer", "fares"] },
    intro: { type: "string" },
    items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, note: { type: "string" }, source: { type: "number" } }, required: ["name", "address", "note", "source"], additionalProperties: false } },
    fares: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["airline", "price", "priceBasis", "stops", "note", "source"],
      properties: {
        airline: { type: "string" }, price: { type: "string" },
        priceBasis: { type: "string", enum: ["one_way", "round_trip", "unspecified"] },
        stops: { type: "string", enum: ["nonstop", "one_stop", "two_plus_stops", "unspecified"] },
        note: { type: "string" }, source: { type: "number" },
      },
    } },
    answer: { type: "string" },
    caveat: { type: "string" },
    sufficient: { type: "boolean" },
    missingQuery: { type: "string" },
  },
  required: ["kind", "intro", "items", "fares", "answer", "caveat", "sufficient", "missingQuery"],
  additionalProperties: false,
} as const;

/** Text from the web or the model that goes into a card: one line, and none of the characters that make markdown links or emphasis. */
export const plain = (value: string, max = 160) => value.replace(/[\r\n]+/g, " ").replace(/[*_`\[\]()<>#|\\]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** The place named in the search itself ("Chinese restaurants in Sunnyvale, CA" gives "Sunnyvale, CA"), to point a Maps search at the right town. */
export function placeContext(query: string) {
  const match = query.match(/\b(?:in|near|around)\s+([^,.?!]+(?:,\s*[A-Za-z]{2,})?)\s*$/i);
  return match ? plain(match[1], 80) : "";
}

export function mapsLink(name: string, address: string, query: string) {
  const where = address || placeContext(query);
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", [name, where].filter(Boolean).join(" "));
  return url.toString();
}

/** The model's own markdown, made safe: no headings, and links become plain text so untrusted search results cannot put links in the answer. */
export function cleanModelText(value: string) {
  return value.replace(/^#{1,6}\s+/gm, "").replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)").trim();
}

const cite = (source: number, count: number) => (Number.isInteger(source) && source >= 1 && source <= count ? ` [${source}]` : "");

const PRICE_BASIS_LABEL: Record<FareRow["priceBasis"], string> = { one_way: "one-way", round_trip: "round-trip", unspecified: "basis not stated" };
const STOPS_LABEL: Record<FareRow["stops"], string> = { nonstop: "nonstop", one_stop: "1 stop", two_plus_stops: "2+ stops", unspecified: "stops not stated" };

/** Markdown for the reply. Place lists use the card shape the chat draws as cards, fares use a table, and read fine as a plain list or
 * table anywhere else (WhatsApp, history). */
export function renderSearchAnswer(result: SearchAnswer, query: string, sourceCount: number) {
  const intro = plain(result.intro, 200);
  const caveat = plain(result.caveat, 200);
  if (result.kind === "places") {
    const cards = result.items.slice(0, 5).map((item) => {
      const name = plain(item.name, 80);
      if (!name) return "";
      const address = plain(item.address, 120);
      const note = plain(item.note, 140);
      return `- **${name}**${note ? ` — ${note}` : ""}${cite(item.source, sourceCount)}  \n  ${address ? `${address} · ` : ""}[Open in Maps](${mapsLink(name, address, query)})`;
    }).filter(Boolean);
    if (cards.length) return [intro, cards.join("\n"), caveat && `*${caveat}*`].filter(Boolean).join("\n\n");
  }
  if (result.kind === "fares") {
    const rows = result.fares.slice(0, 8).map((row) => {
      const price = plain(row.price, 20);
      if (!price) return "";
      // A bare dash reads like the render dropped something; "not listed" says plainly that the source itself didn't name a carrier for
      // this fare (found live, R32) — honest per the prompt's "'' only if truly not given" rule, just not communicated clearly to the reader.
      const airline = plain(row.airline, 40) || "airline not listed";
      const note = plain(row.note, 100);
      return `| ${airline} | ${price} (${PRICE_BASIS_LABEL[row.priceBasis]}) | ${STOPS_LABEL[row.stops]} | ${note}${cite(row.source, sourceCount)} |`;
    }).filter(Boolean);
    if (rows.length) return [intro, ["| Airline | Price | Stops | Note |", "|---|---|---|---|", ...rows].join("\n"), caveat && `*${caveat}*`].filter(Boolean).join("\n\n");
  }
  // A plain answer keeps the model's own markdown (lists, bold), without headings, and with any link turned into plain text: this text came from the web.
  return [intro, cleanModelText(result.answer), caveat && `*${caveat}*`].filter(Boolean).join("\n\n");
}
