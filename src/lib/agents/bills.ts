import { isCloseSpelling } from "./email-query";

export type DocumentKind = "bill" | "payment" | "purchase";
export type Bill = {
  id: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  category: string;
  statementDate: string;
  dueDate: string | null;
  status: "outstanding" | "paid";
  paidOn: string | null;
};

// R17.1: by subject. Payment words win, because "payment received for your bill" is a payment.
const PAYMENT_SUBJECT = /\b(?:payment (?:received|confirmation|successful|receipt|was (?:made|processed))|(?:we['’]ve|we have) received your payment|thank you for your payment|autopay (?:payment )?(?:processed|received|successful)|payment (?:made|processed)|payment (?:has )?(?:posted|cleared)|your (?:credit card |card |bill )?payment (?:of \$?[\d,.]+ )?(?:was|has been) (?:received|posted|processed|successful)|thank you for (?:making )?your (?:credit card |card )?payment|received your (?:credit card |card )?payment|your (?:[\w&.'’-]+ ){1,3}payment (?:of \$?[\d,.]+ )?(?:was|has been|is) (?:received|posted|processed|successful|confirmed)|payment (?:is |has been )?(?:confirmed|received))\b/i;
const BILL_SUBJECT = /\b(?:(?:statement|bill)\s+(?:is\s+)?(?:now\s+)?(?:ready|available|here)|(?:your|new|latest|monthly)(?:\s+\w+){0,2}\s+(?:statement|bill)\b|amount due|payment due|energy statement)/i;

export function classifyDocument(subject: string): DocumentKind {
  if (PAYMENT_SUBJECT.test(subject)) return "payment";
  if (BILL_SUBJECT.test(subject)) return "bill";
  return "purchase";
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE = String.raw`((?:${MONTHS})[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})`;
const DUE = new RegExp(String.raw`(?:payment\s+)?due(?:\s+(?:date|on|by))?\s*[:\-]?\s*${DATE}|pay\s+by\s*[:\-]?\s*${DATE}|due\s+by\s+${DATE}`, "i");

const pad = (value: number) => String(value).padStart(2, "0");

/** A date in an email → ISO. A date with no year takes the statement's year, and rolls to the next year if that would be before the statement. */
export function parseLooseDate(value: string, reference: string): string | null {
  const text = value.trim().replace(/(\d)(?:st|nd|rd|th)/i, "$1");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`;
  const named = text.match(new RegExp(String.raw`^(${MONTHS})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$`, "i"));
  if (!named) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].toLowerCase().slice(0, 3)) + 1;
  if (month < 1) return null;
  let year = named[3] ? Number(named[3]) : Number(reference.slice(0, 4));
  let result = `${year}-${pad(month)}-${pad(Number(named[2]))}`;
  if (!named[3] && result < reference) { year += 1; result = `${year}-${pad(month)}-${pad(Number(named[2]))}`; }
  return result;
}

/** R17.2: the due date when the email states one, else null. */
export function extractDueDate(text: string, statementDate: string): string | null {
  const match = text.match(DUE);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  return raw ? parseLooseDate(raw, statementDate) : null;
}

const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9&]+/g, " ").trim();

// "Pacific Gas and Electric Company" → "pge", which is what "PG&E" compacts to.
const acronym = (value: string) => normalize(value).split(" ").filter((word) => word && !["and", "of", "the", "company", "co", "inc", "llc", "corp"].includes(word)).map((word) => word[0]).join("");
const compact = (value: string) => normalize(value).replace(/[^a-z0-9]/g, "");

export function sameMerchant(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if ((acronym(left).length >= 3 && acronym(left) === compact(right)) || (acronym(right).length >= 3 && acronym(right) === compact(left))) return true;
  return a.split(" ").some((word) => b.split(" ").some((other) => word.length >= 4 && isCloseSpelling(word, other)));
}

/** R17.4: the outstanding bill a payment settles, or null. */
export function matchPayment(bills: Bill[], payment: { merchant: string; amountMinor: number; date: string }) {
  const tolerance = (bill: Bill) => Math.max(100, Math.round(bill.amountMinor * 0.01));
  return bills
    .filter((bill) => bill.status === "outstanding" && sameMerchant(bill.merchant, payment.merchant) && bill.statementDate <= payment.date && Math.abs(bill.amountMinor - payment.amountMinor) <= tolerance(bill))
    .sort((left, right) => Math.abs(left.amountMinor - payment.amountMinor) - Math.abs(right.amountMinor - payment.amountMinor) || right.statementDate.localeCompare(left.statementDate))[0] ?? null;
}

/** R17.6: outstanding bills of an autopay merchant whose due date has arrived. */
export function autopayDue(bills: Bill[], autopayMerchants: string[], today: string) {
  return bills.filter((bill) => bill.status === "outstanding" && bill.dueDate !== null && bill.dueDate <= today && autopayMerchants.some((merchant) => sameMerchant(bill.merchant, merchant)));
}

/** R17.7 */
export function pastDue(bills: Bill[], today: string) {
  return bills.filter((bill) => bill.status === "outstanding" && bill.dueDate !== null && bill.dueDate < today);
}

export type BillsCommand =
  | { type: "list" }
  | { type: "paid"; merchant: string; paidOn: string | null }
  | { type: "autopay"; merchant: string };

const EMAILISH = /\b(?:find|search|email|emails|inbox|gmail|received|receipt|receipts)\b/i;
const LIST = /\bwhat do i owe\b|\bhow much do i owe\b|\b(?:my|any)\s+(?:unpaid |outstanding |pending |open |upcoming )?bills?\b|\bbills?\s+(?:are\s+|do i have\s+)?(?:outstanding|due|unpaid|pending|left)\b|\b(?:what|which)\s+bills\b|\b(?:outstanding|unpaid|pending|upcoming)\s+bills?\b|\bwhat(?:'s| is| are)\s+(?:the\s+)?(?:bills?|due)\b/i;
const PAID = new RegExp(String.raw`\bi(?:'ve| have)?\s+(?:just |already )?paid\s+(?:the |my |our )?(.{2,40}?)\s+bill\b(?:.*?\bon\s+${DATE})?|\bmark\s+(?:the |my )?(.{2,40}?)\s+bill\s+(?:as\s+)?paid\b(?:.*?\bon\s+${DATE})?|\b(?:the |my )?(.{2,40}?)\s+bill\s+(?:is|was)\s+paid\b(?:.*?\bon\s+${DATE})?`, "i");
const AUTOPAY = /^(?:please\s+)?(?:the |my )?(.{2,40}?)\s+(?:bill\s+)?(?:is|are)\s+on\s+(?:auto[- ]?pay|automatic payments?)\b|^(?:i(?:'ve| have)?\s+)?(?:set up|turned on|have)\s+auto[- ]?pay\s+(?:for|on)\s+(?:the |my )?(.{2,40}?)[.!]*$/i;

/** R17.5, R17.6, R17.8 */
export function parseBillsCommand(input: string, today: string): BillsCommand | null {
  const text = input.trim();
  if (text.length > 120) return null;
  const autopay = text.match(AUTOPAY);
  const autopayMerchant = (autopay?.[1] ?? autopay?.[2])?.trim();
  if (autopayMerchant) return { type: "autopay", merchant: autopayMerchant.replace(/[.!?]+$/, "") };
  const paid = text.match(PAID);
  if (paid) {
    const merchant = (paid[1] ?? paid[3] ?? paid[5])?.trim();
    const date = paid[2] ?? paid[4] ?? paid[6];
    if (merchant) return { type: "paid", merchant, paidOn: date ? parseLooseDate(date, today) : null };
  }
  if (!EMAILISH.test(text) && LIST.test(text)) return { type: "list" };
  return null;
}

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** R17.3 */
export function outstandingNote(bills: Bill[], today: string) {
  const open = bills.filter((bill) => bill.status === "outstanding");
  if (!open.length) return "";
  const currencies = new Set(open.map((bill) => bill.currency));
  const total = currencies.size === 1 ? `, ${money(open.reduce((sum, bill) => sum + bill.amountMinor, 0), open[0].currency)}` : "";
  const detail = open.slice(0, 3).map((bill) => `${bill.merchant}${bill.dueDate ? `, due ${day(bill.dueDate)}` : ""}`).join("; ");
  return `Not counted yet: ${open.length} unpaid bill${open.length === 1 ? "" : "s"}${total} (${detail}${open.length > 3 ? "; …" : ""}).`;
}

/** R17.7, R17.8: past due first, each with the question. `found` are payment emails Daylark noticed for a bill (R17.8). */
export function renderBills(bills: Bill[], today: string, found: Array<{ billId: string; date: string; amountMinor: number }> = []) {
  const open = bills.filter((bill) => bill.status === "outstanding");
  if (!open.length) return "No outstanding bills. Anything you paid is already counted in your spending.";
  const late = pastDue(open, today).sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));
  const rest = open.filter((bill) => !late.includes(bill)).sort((left, right) => (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999"));
  const line = (bill: Bill) => {
    const payment = found.find((item) => item.billId === bill.id);
    const due = bill.dueDate ? `due ${day(bill.dueDate)}${bill.dueDate < today ? ` (${daysBetween(bill.dueDate, today)} days ago)` : ""}` : `billed ${day(bill.statementDate)}, no due date`;
    const hint = payment
      ? ` I found a payment email for ${money(payment.amountMinor, bill.currency)} on ${day(payment.date)}. Say “I paid the ${bill.merchant} bill on ${day(payment.date)}” to mark it paid.`
      : bill.dueDate && bill.dueDate < today ? ` Did you pay it? Say “I paid the ${bill.merchant} bill”.` : "";
    return `- **${bill.merchant}** — ${money(bill.amountMinor, bill.currency)} · ${due}.${hint}`;
  };
  const currencies = new Set(open.map((bill) => bill.currency));
  const total = currencies.size === 1 ? `\n\n**Total outstanding: ${money(open.reduce((sum, bill) => sum + bill.amountMinor, 0), open[0].currency)}**` : "";
  return `### Bills outstanding\n\n${late.length ? `**Past due**\n${late.map(line).join("\n")}\n\n` : ""}${rest.length ? `${late.length ? "**Upcoming**\n" : ""}${rest.map(line).join("\n")}` : ""}${total}\n\nThese aren't counted as spending until they're paid.`;
}
