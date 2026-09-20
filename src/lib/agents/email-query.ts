import { Temporal } from "@js-temporal/polyfill";

export const RECEIPT_WORDS = /\b(?:receipts?|invoices?|purchases?|orders?|tickets?|bills?|statements?)\b/i;
const PROMO_WORDS = /\b(?:promotion|promotions|promotional|offers?|deals?|discounts?|coupons?|sales?)\b/i;
const RECRUITER_WORDS = /\b(?:recruiter|recruiters|recruiting|job opportunity|hiring)\b/i;
const DOMAIN_VOCABULARY = ["invoice", "invoices", "receipt", "receipts", "statement", "statements", "email", "emails", "total", "amount", "promotion", "promotions", "recruiter", "recruiters", "billing"];

/** Fixes misspelled domain words (invoic, totl). Only lowercase words, so brand names are never rewritten. */
export function fixDomainTypos(input: string) {
  return input.replace(/\b[a-z]{4,}\b/g, (word) => {
    // A word that extends a vocabulary word (promotional, totals) is valid English, not a typo.
    if (DOMAIN_VOCABULARY.some((candidate) => word.startsWith(candidate))) return word;
    return DOMAIN_VOCABULARY.find((candidate) => isCloseSpelling(word, candidate)) ?? word;
  });
}

/** Splits "…, but skip anything promotional" into the request and the excluded topics. */
export function stripExclusions(input: string) {
  const match = input.match(/[,;]?\s*\b(?:but\s+|and\s+)?(?:skip|exclude|excluding|except|without|ignore|ignoring|not|no)\b\s+([^.?!]*)/i);
  if (!match || match.index === undefined) return { core: input, exclusions: "", clause: "" };
  return { core: input.slice(0, match.index).trim() || input, exclusions: match[1], clause: input.slice(match.index).replace(/^[,;]?\s*(?:but\s+|and\s+)?/i, "").trim() };
}

const EXCLUSION_STOPWORDS = new Set(["or", "and", "the", "any", "anything", "notices", "notice", "emails", "email", "messages", "message", "ones", "one", "regular", "just", "only", "from", "to", "of", "a", "an", "automated", "plain"]);

export function exclusionTerms(input: string, requestedSender: string | null) {
  const sender = (requestedSender ?? "").toLowerCase();
  return stripExclusions(input).exclusions.toLowerCase().split(/[^\p{L}\p{N}&]+/u)
    .filter((word) => word.length >= 4 && !EXCLUSION_STOPWORDS.has(word) && !sender.includes(word));
}

const COUNT_WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const COUNT = String.raw`(?:\d{1,3}|a|one|two|three|four|five|six|seven|eight|nine|ten|twelve)`;
const UNIT = String.raw`(?:day|week|month|year)s?`;
// R3.4: "last week", "past 2 weeks", "in the last 30 days", "search 90 days", "look back 6 months", "go back a year", "for 3 months", or a bare "90 days".
export const PERIOD_PATTERN = String.raw`(?:(?:(?:in |over |within )?the )?(?:last|past|previous)\s+(?:${COUNT}\s+)?${UNIT}|(?:search(?:ing)?(?: back)?|look(?:ing)? back|go(?:ing)? back|back|for|over)\s+(?:the (?:last|past)\s+)?${COUNT}\s+${UNIT}|\d{1,3}\s*${UNIT})`;

/** "last 30 days", "last one month", "past 2 weeks", "last week" → number of days (capped at a year). */
export function recencyDays(input: string) {
  const phrase = input.match(new RegExp(String.raw`\b${PERIOD_PATTERN}\b`, "i"))?.[0];
  if (!phrase) return null;
  const count = phrase.match(new RegExp(String.raw`\b(${COUNT})\b`, "i"))?.[1];
  const unit = phrase.match(/day|week|month|year/i)![0].toLowerCase() as "day" | "week" | "month" | "year";
  const n = count ? COUNT_WORDS[count.toLowerCase()] ?? Number(count) : 1;
  return Math.min(n * { day: 1, week: 7, month: 30, year: 365 }[unit], 365);
}

export function toGmailQuery(input: string, timeZone = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles", options: { ignoreSender?: boolean; ignoreDate?: boolean } = {}) {
  const { core, exclusions } = stripExclusions(input);
  const email = core.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
  const sender = options.ignoreSender ? null : extractRequestedSender(input);
  const quoted = [...core.matchAll(/["“]([^"”]+)["”]/g)].map((match) => `"${match[1]}"`);
  const recency = options.ignoreDate ? null : recencyDays(core);
  const dates = options.ignoreDate ? "" : dateQuery(core, timeZone);
  const parts = [email ? `from:${email}` : sender ? organizationQuery(sender) : "", dates, recency ? `newer_than:${recency}d` : "", /\bunread\b/i.test(core) ? "is:unread" : "", ...quoted].filter(Boolean);
  if (RECRUITER_WORDS.test(core)) parts.push('{recruiter recruiting "talent acquisition" hiring interview opportunity staffing sourcer}');
  // R4.6: confirmation-style subjects, so promo and shipping mail from the same store cannot crowd out real receipts.
  else if (RECEIPT_WORDS.test(core)) parts.push("{subject:confirmed subject:confirmation subject:receipt subject:invoice subject:ordered subject:order subject:statement subject:bill subject:payment}");
  else if (PROMO_WORDS.test(core)) parts.push('{category:promotions promotion promotional offer deal discount coupon sale}');
  if (PROMO_WORDS.test(exclusions)) parts.push("-category:promotions");
  if ((options.ignoreSender || options.ignoreDate) && !dates && !recency) parts.push("newer_than:365d");
  if (!parts.length) {
    const terms = core.replace(/\b(find|search|show|have|has|got|any|email|emails|mail|mails|inbox|me|my|i|the|a|an|about|latest|recent|today|yesterday)\b/gi, " ").replace(/[^\p{L}\p{N}@._+-]+/gu, " ").trim();
    if (terms) parts.push(terms);
  }
  return parts.join(" ") || "newer_than:30d";
}

export function describeEmailSearch(input: string) {
  const { core } = stripExclusions(input);
  const sender = extractRequestedSender(input);
  const topic = RECRUITER_WORDS.test(core) ? "recruiting, hiring, interview, staffing, and job-opportunity language"
    : RECEIPT_WORDS.test(core) ? "receipts, invoices, orders, tickets, and statements"
    : PROMO_WORDS.test(core) ? "promotions, offers, discounts, coupons, and sale announcements" : null;
  if (topic && sender) return `${topic} from ${sender}`;
  return topic ?? (sender ? `messages associated with ${sender}` : "the requested terms");
}

export const NOT_A_SENDER = /^(?:my|me|the|a|an|you|your|our|their|all|any|this|that|these|those|last|past|today|yesterday)$/i;
const BRAND_LEAD_STOPWORDS = /^(?:Find|Show|Get|Did|Do|Does|Have|Has|Any|My|The|Latest|Newest|Recent|Check|List|Search|What|Where|When|How|Is|Are|Was|Were|Can|Could|I|Also|And|Only|Every|Each|Send|Look)$/;

export const GENERIC_LEAD = /^(?:mean|meant|meaning|amount|amounts|total|totals|price|prices|cost|costs|want|wanted|need|needed|see|got|get|have|had|only|just|also|more|most|them|it|either|both|no|not|all|any|every|each|my|the|your|our|latest|newest|recent|last|past|new|old|next|show|find|list|get|check|search|and|for|from|with|duplicate|duplicates|unread|unpaid|paid|pending|monthly|weekly|yearly|annual|digital|paper|actual|real|other|same|those|these|that|this|some|few|many|large|small|total|final|open|closed|missing|extra|promotional|receipt|receipts|invoice|invoices|order|orders|bill|bills|statement|statements|ticket|tickets|email|emails|mail|gmail|inbox)$/i;

export function extractRequestedSender(rawInput: string) {
  // A trailing window ("look back 3 months") is longer than a sender can be, so remove it before looking for the name.
  const input = stripExclusions(rawInput).core.replace(new RegExp(String.raw`\s*\b${PERIOD_PATTERN}\b\s*[?.!]*\s*$`, "i"), "");
  if (input.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)) return null;
  const sender = input.match(/\bfrom\s+([\p{L}\p{N}+@&'_-]+(?:\.[\p{L}\p{N}-]+)*(?:\s+[\p{L}\p{N}+@&'_-]+(?:\.[\p{L}\p{N}-]+)*){0,3}?)(?=\s+(?:in|during|within|over|since|before|after|last|past|today|yesterday|this week|and|then|tell|show|with|about|that|which|for|please|any|emails?|mails?|messages?)\b|[?.!,]|$)/iu)?.[1]?.trim() ?? null;
  if (sender) {
    // A trailing window ("search 90 days", "last 30 days") belongs to the request, not the sender's name.
    const bare = sender.replace(new RegExp(String.raw`\s*${PERIOD_PATTERN}\s*$`, "i"), "").trim();
    if (bare !== sender) return bare && !NOT_A_SENDER.test(bare.split(/\s+/)[0]) ? bare : null;
    if (/^(?:recruiters?|hiring managers?|companies|jobs?)$/i.test(sender) || NOT_A_SENDER.test(sender.split(/\s+/)[0])) return null;
    return sender;
  }
  // "my Amazon order", "Adobe invoice": a capitalized brand right before a document noun.
  const brand = [...input.matchAll(/\b([A-Z][\p{L}\p{N}&'-]+(?:\s+[A-Z][\p{L}\p{N}&'-]+)?)(?:['’]s)?\s+(?:orders?|invoices?|receipts?|statements?|bills?|tickets?)\b/gu)]
    .map((match) => match[1].split(/\s+/).filter((word) => !BRAND_LEAD_STOPWORDS.test(word)).join(" "))
    .find(Boolean);
  if (brand) return brand;
  // Lowercase store names: "all iherb receipts".
  const lower = input.match(/\b([\p{L}\p{N}&'-]{3,})\s+(?:orders?|invoices?|receipts?|statements?|bills?|tickets?)\b/iu)?.[1];
  return lower && !GENERIC_LEAD.test(lower) ? lower : null;
}

function dateQuery(input: string, timeZone: string) {
  const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  if (/\btoday\b/i.test(input)) return range(today, today.add({ days: 1 }));
  if (/\byesterday\b/i.test(input)) return range(today.subtract({ days: 1 }), today);
  if (/\bthis week\b/i.test(input)) return range(today.subtract({ days: today.dayOfWeek - 1 }), today.add({ days: 1 }));
  return "";
}

function range(start: Temporal.PlainDate, end: Temporal.PlainDate) {
  return `after:${start.toString().replaceAll("-", "/")} before:${end.toString().replaceAll("-", "/")}`;
}

function organizationQuery(sender: string) {
  const safe = sender.replaceAll('"', "");
  return `{from:"${safe}" "${safe}"}`;
}

export function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function isCloseSpelling(left: string, right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a.length < 4 || b.length < 4) return a === b;
  return editDistance(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
}

/** R3.2, R16.4: the last check on any sender, whoever proposed it. */
export function isPlausibleSender(name: string) {
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 60 || /[\n\r]/.test(cleaned)) return false;
  const first = cleaned.split(/\s+/)[0];
  if (NOT_A_SENDER.test(first) || GENERIC_LEAD.test(first)) return false;
  return !/\b(?:receipts?|invoices?|amounts?|emails?|mails?|orders?|statements?|promotions?|promotional|recruiters?|unread|today|yesterday|days?|weeks?|months?|years?)\b/i.test(cleaned);
}
