import { z } from "zod";

/**
 * A web search answer as structured data. The model fills it in from the search evidence; code turns it into the reply, so the shape of the
 * reply and every link in it are decided here, not by text from the web.
 */
export const searchAnswerSchema = z.object({
  kind: z.enum(["places", "answer"]),
  intro: z.string(),
  items: z.array(z.object({ name: z.string(), address: z.string(), note: z.string(), source: z.number() })),
  answer: z.string(),
  caveat: z.string(),
});
export type SearchAnswer = z.infer<typeof searchAnswerSchema>;

export const SEARCH_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["places", "answer"] },
    intro: { type: "string" },
    items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, note: { type: "string" }, source: { type: "number" } }, required: ["name", "address", "note", "source"], additionalProperties: false } },
    answer: { type: "string" },
    caveat: { type: "string" },
  },
  required: ["kind", "intro", "items", "answer", "caveat"],
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

/** Markdown for the reply. Place lists use the card shape the chat draws as cards, and read fine as a plain list anywhere else. */
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
  // A plain answer keeps the model's own markdown (lists, bold), without headings, and with any link turned into plain text: this text came from the web.
  return [intro, cleanModelText(result.answer), caveat && `*${caveat}*`].filter(Boolean).join("\n\n");
}
