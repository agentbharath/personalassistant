const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)`;
// $12.34, US$12.34, USD 12.34, or 12.34 USD
const AMOUNT = String.raw`(?:(?:US\$|\$|USD\s?)\s?${NUMBER}|${NUMBER}\s?(?:USD|US\$))`;
const LABELED_AMOUNT = new RegExp(String.raw`(?<![a-z])(?:grand total|total(?:\s+amount)?(?:\s+(?:due|paid|charged))?|amount(?:\s+(?:due|paid|charged))?|balance due|charged|payment of)\s*[:\-]?\s*${AMOUNT}`, "i");
const ANY_AMOUNT = new RegExp(AMOUNT, "gi");
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE = String.raw`((?:${MONTHS})[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})`;
const LABELED_DATE = new RegExp(String.raw`(invoice date|billing date|billed on|date paid|payment date|paid on|order date|date of issue|due date)\s*[:\-]?\s*${DATE}`, "i");

export type InvoiceFacts = { amount: string | null; billingDate: string | null; dateLabel: string | null };

export function asksForInvoiceFacts(input: string) {
  return /\b(amounts?|totals?|how much|billing date|bill date|charged|paid|due|costs?)\b/i.test(input);
}

export function extractInvoiceFacts(email: { subject: string; snippet: string; text: string }): InvoiceFacts {
  const evidence = `${email.subject}\n${email.snippet}\n${email.text}`;
  const labeledMatch = evidence.match(LABELED_AMOUNT);
  const labeled = labeledMatch?.[1] ?? labeledMatch?.[2];
  const distinct = new Set([...evidence.matchAll(ANY_AMOUNT)].map((match) => normalizeAmount(match[1] ?? match[2])));
  const amount = labeled ? normalizeAmount(labeled) : distinct.size === 1 ? [...distinct][0] : null;
  const dateMatch = evidence.match(LABELED_DATE);
  return {
    amount: amount ? `$${amount}` : null,
    billingDate: dateMatch ? formatDate(dateMatch[2]) : null,
    dateLabel: dateMatch ? dateMatch[1].toLowerCase() : null,
  };
}

function normalizeAmount(value: string) {
  const [whole, cents = "00"] = value.replaceAll(",", "").split(".");
  return `${Number(whole).toLocaleString("en-US")}.${cents.padEnd(2, "0")}`;
}

function formatDate(value: string) {
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = slash ? new Date(Date.UTC(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2])))
    : iso ? new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
    : new Date(`${value.replace(/\./, "")} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

/** Non-sensitive detail for "no total" skips, so a missing amount can be diagnosed without showing the email. */
export function describeMissingTotal(email: { subject: string; snippet: string; text: string }) {
  const evidence = `${email.subject}\n${email.snippet}\n${email.text}`;
  const amounts = new Set([...evidence.matchAll(ANY_AMOUNT)].map((match) => normalizeAmount(match[1] ?? match[2])));
  const plainNumbers = (evidence.match(/\b\d+\.\d{2}\b/g) ?? []).length;
  const body = `${email.text.length} characters read`;
  if (amounts.size > 1) return `${amounts.size} different amounts but none labeled as the total (${body})`;
  return `no dollar amount in the text (${body}, ${plainNumbers} price-like numbers); the total may be an image`;
}

const MONEY_WORDS = /(?:grand total|order total|order summary|subtotal|total|amount|charged|paid|payment|balance)/gi;

/** Model evidence within a size budget: the start of the email plus windows around money words, so a total deep in a long email is never cut off. */
export function buildEvidence(email: { subject: string; from: string; date: string; snippet: string; text: string }, limit = 18_000) {
  const header = [`Subject: ${email.subject}`, `From: ${email.from}`, `Received: ${email.date}`, `Snippet: ${email.snippet}`].join("\n");
  const budget = limit - header.length - 20;
  const text = email.text;
  if (text.length <= budget) return `${header}\nBody: ${text}`;
  const windows: Array<[number, number]> = [[0, Math.min(3_000, budget / 4)]];
  for (const match of text.matchAll(MONEY_WORDS)) {
    const start = Math.max(0, (match.index ?? 0) - 600);
    const end = Math.min(text.length, (match.index ?? 0) + 900);
    const last = windows.at(-1)!;
    if (start <= last[1]) last[1] = Math.max(last[1], end); else windows.push([start, end]);
    if (windows.reduce((sum, [from, to]) => sum + to - from, 0) >= budget) break;
  }
  const body = windows.map(([from, to]) => text.slice(from, to)).join(" … ").slice(0, budget);
  return `${header}\nBody: ${body}`;
}
