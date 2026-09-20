import { readGmailMessage, searchGmail } from "@/lib/tools/email/google-gmail";
import { senderMatches } from "./email";
import { isPlausibleSender } from "./email-query";

export type StatusLookup = { sender: string; matter: string };

const MATTER = "dispute|claim|case|refund|return|application|ticket|request|complaint|chargeback";
// R18.2: companies use different words for the same matter (Chase calls a card dispute a "claim").
export const MATTER_WORDS: Record<string, string[]> = {
  dispute: ["dispute", "claim", "chargeback", "provisional credit"],
  claim: ["claim", "dispute", "chargeback"],
  chargeback: ["chargeback", "dispute", "claim"],
  refund: ["refund", "reversal", "credit issued"],
  return: ["return", "refund"],
  case: ["case", "ticket"],
  ticket: ["ticket", "case"],
  complaint: ["complaint", "case"],
  application: ["application"],
  request: ["request"],
};
const searchTerms = (matter: string) => `{${(MATTER_WORDS[matter] ?? [matter]).map((word) => (word.includes(" ") ? `"${word}"` : word)).join(" ")}}`;

const NAME = String.raw`([\p{L}\p{N}&'.-]+(?:\s+[\p{L}\p{N}&'.-]+){0,2}?)`;
const PATTERNS = [
  new RegExp(String.raw`\b(?:what(?:'s| is)|whats|any|is there any)\s+(?:the\s+)?(?:status|update|progress|news)\b.*?\b(?:of|on|about|with|for)\s+(?:my|the)\s+${NAME}\s+(${MATTER})s?\b`, "iu"),
  new RegExp(String.raw`\b(?:status|update|progress)\s+(?:of|on|about|for)\s+(?:my|the)\s+${NAME}\s+(${MATTER})s?\b`, "iu"),
  new RegExp(String.raw`\bwhere(?:'s| is)\s+my\s+${NAME}\s+(${MATTER})s?\b`, "iu"),
  new RegExp(String.raw`\bhas\s+${NAME}\s+(?:responded|replied|updated|answered|decided)\b.*?\b(${MATTER})s?\b`, "iu"),
];

/** R18.1: "what's the status of my chase dispute" → { sender: "chase", matter: "dispute" }. */
export function parseStatusLookup(input: string): StatusLookup | null {
  const text = input.trim();
  if (text.length > 140) return null;
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    const sender = match?.[1]?.trim();
    if (sender && match?.[2] && isPlausibleSender(sender)) return { sender, matter: match[2].toLowerCase() };
  }
  return null;
}

const day = (value: string | number) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};
const escape = (value: string) => value.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");

/** R18.2–R18.4 */
export async function answerStatusLookup(userId: string, lookup: StatusLookup) {
  const name = lookup.sender.replaceAll('"', "");
  const found = (await searchGmail(userId, `{from:"${name}" "${name}"} ${searchTerms(lookup.matter)} newer_than:365d`, 20))
    .filter((message) => senderMatches(message.from, lookup.sender))
    .sort((left, right) => right.receivedAt - left.receivedAt);
  const seen = new Set<string>();
  const unique = found.filter((message) => (seen.has(message.threadId) ? false : (seen.add(message.threadId), true)));
  // A marketing email can mention "claim your bonus" in its body. Prefer mail whose subject is about the matter.
  const words = (MATTER_WORDS[lookup.matter] ?? [lookup.matter]).map((word) => word.toLowerCase());
  const aboutIt = unique.filter((message) => words.some((word) => message.subject.toLowerCase().includes(word)));
  const threads = aboutIt.length ? aboutIt : unique;
  const related = (MATTER_WORDS[lookup.matter] ?? [lookup.matter]).filter((word) => word !== lookup.matter);
  const terms = `_Searched: email from ${escape(lookup.sender)} mentioning “${lookup.matter}”${related.length ? ` or ${related.map((word) => `“${word}”`).join(", ")}` : ""} · last 365 days._`;
  if (!threads.length) {
    return `I don't see any email from ${lookup.sender} mentioning a ${lookup.matter}${related.length ? ` (or ${related.join(", ")})` : ""} in the last year. Is the company named differently in your email, or was it handled by phone or letter? Tell me the exact sender or a word from the subject and I'll look again.\n\n${terms}`;
  }
  const latest = await readGmailMessage(userId, threads[0].id);
  const excerpt = latest.text.replace(/\[link\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  const earlier = threads.slice(1, 4).map((message) => `- **${escape(message.subject)}** · ${day(message.date || message.receivedAt)}`);
  return [
    `### ${escape(lookup.sender)} — ${lookup.matter}`,
    `**Latest email, ${day(latest.date || latest.receivedAt)}:** ${escape(latest.subject)}\n\n${escape(excerpt)}${latest.text.length > 500 ? "…" : ""}`,
    earlier.length ? `**Earlier**\n${earlier.join("\n")}` : "",
    `That's what the most recent email said, as of ${day(latest.date || latest.receivedAt)}. For the live status, check with ${escape(lookup.sender)} directly.`,
    terms,
  ].filter(Boolean).join("\n\n");
}
