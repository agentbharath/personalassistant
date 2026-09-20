import { stripExclusions } from "@/lib/agents/email-query";
import { RECEIPT_WORDS } from "@/lib/agents/email-query";
import type { EmailRequest } from "@/lib/agents/email-request";
import type { EmailIntent } from "@/lib/agents/email-relevance";

export const DEFAULT_WINDOW_DAYS = 30;

export type Learnings = {
  /** Default window in days, per topic or for everything ("all"). */
  defaultDays: Partial<Record<EmailIntent | "all", number>>;
  /** lower-cased typed sender → the sender the user meant. */
  senderAliases: Record<string, string>;
  /** R11.8: what a plain request for a topic means. Only receipts, and only "amounts", for now. */
  defaultActions: Partial<Record<EmailIntent, "amounts">>;
  /** R14.1: minutes. Length applies only to events with no end; buffer is added to feasibility answers. */
  calendar: { durationMinutes?: number; bufferMinutes?: number };
  /** R14.2: lower-cased merchant → category, and lower-cased alias → canonical merchant name. */
  merchantCategories: Record<string, string>;
  merchantAliases: Record<string, string>;
  /** R17.6: merchants whose bills are paid automatically on the due date. */
  autopay: string[];
  /** A saved home city or ZIP, used as the default place for travel time and local searches. */
  homeLocation?: string;
};
export const NO_LEARNINGS: Learnings = { defaultDays: {}, senderAliases: {}, defaultActions: {}, calendar: {}, merchantCategories: {}, merchantAliases: {}, autopay: [] };

export type Learning =
  | { kind: "default_window"; topic: EmailIntent | "all"; days: number }
  | { kind: "sender_alias"; alias: string; canonical: string }
  | { kind: "default_action"; topic: EmailIntent; action: "amounts" }
  | { kind: "calendar_duration"; minutes: number }
  | { kind: "calendar_buffer"; minutes: number }
  | { kind: "merchant_category"; merchant: string; category: string }
  | { kind: "merchant_alias"; alias: string; canonical: string }
  | { kind: "autopay"; merchant: string }
  | { kind: "home_location"; place: string };

/** The one place that says how a learning is folded into the in-memory set. */
export function withLearning(learnings: Learnings, learning: Learning): Learnings {
  switch (learning.kind) {
    case "default_window": return { ...learnings, defaultDays: { ...learnings.defaultDays, [learning.topic]: learning.days } };
    case "sender_alias": return { ...learnings, senderAliases: { ...learnings.senderAliases, [learning.alias.toLowerCase()]: learning.canonical } };
    case "default_action": return { ...learnings, defaultActions: { ...learnings.defaultActions, [learning.topic]: learning.action } };
    case "calendar_duration": return { ...learnings, calendar: { ...learnings.calendar, durationMinutes: learning.minutes } };
    case "calendar_buffer": return { ...learnings, calendar: { ...learnings.calendar, bufferMinutes: learning.minutes } };
    case "merchant_category": return { ...learnings, merchantCategories: { ...learnings.merchantCategories, [learning.merchant.toLowerCase()]: learning.category } };
    case "merchant_alias": return { ...learnings, merchantAliases: { ...learnings.merchantAliases, [learning.alias.toLowerCase()]: learning.canonical } };
    case "autopay": return { ...learnings, autopay: [...new Set([...learnings.autopay, learning.merchant.toLowerCase()])] };
    case "home_location": return { ...learnings, homeLocation: learning.place };
  }
}

/** R11.1, R11.5: learned aliases first, then a default window unless the user gave one. */
export function applyLearnings(request: EmailRequest, learnings: Learnings, options: { everything?: boolean } = {}) {
  const next = { ...request };
  let aliasedFrom: string | null = null;
  const alias = next.sender ? learnings.senderAliases[next.sender.toLowerCase()] : undefined;
  if (alias && next.sender) { aliasedFrom = next.sender; next.sender = alias; }
  // A single "latest receipt" import needs no window.
  const windowless = next.days === null && next.calendar === null && next.action !== "import";
  // R11.7: "all" is an explicit ask for everything, so it gets the longest window and is not marked as a default.
  const defaulted = windowless && !options.everything;
  if (windowless) next.days = options.everything ? 365 : learnings.defaultDays[next.topic] ?? learnings.defaultDays.all ?? DEFAULT_WINDOW_DAYS;
  return { request: next, defaultedWindow: defaulted, aliasedFrom };
}

const TOPIC_LABEL: Record<EmailIntent, string> = { receipt: "receipts", promotion: "promotions", recruiter: "recruiter emails", general: "all email" };

/** R11.2: the search terms, in plain words. */
export function describeSearch(request: EmailRequest, defaulted: boolean) {
  const window = request.days ? `last ${request.days} days${defaulted ? " (default)" : ""}` : request.calendar ?? "";
  const facts = request.action === "facts" ? "latest invoice, amount and date" : request.action === "amounts" ? "receipts with amounts" : "";
  return [
    facts || TOPIC_LABEL[request.topic],
    request.sender ? `from ${request.sender}` : "",
    window,
    request.unread ? "unread only" : "",
    request.humansOnly ? "real people only" : "",
    request.exclusion ? `excluding: ${request.exclusion.replace(/^(?:skip|exclude|excluding|except|without|ignore|ignoring|not|no)\s+/i, "").replace(/[.?!]+$/, "")}` : "",
  ].filter(Boolean).join(" · ");
}

const COUNT: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const REMEMBER = /\b(?:always|from now on|going forward|by default|as (?:a |the )?default|default to|remember)\b/i;

/** R11.4, R11.6: only explicit corrections teach Daylark. `last` is the previous email request in this conversation. */
export function detectCorrection(input: string, last: EmailRequest | null): Learning | null {
  const text = input.trim();
  if (REMEMBER.test(text)) {
    const match = text.match(/\b(\d{1,3}|a|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(day|week|month|year)s?\b/i);
    if (match) {
      const count = COUNT[match[1].toLowerCase()] ?? Number(match[1]);
      const days = Math.min(count * { day: 1, week: 7, month: 30, year: 365 }[match[2].toLowerCase() as "day" | "week" | "month" | "year"], 365);
      const { core } = stripExclusions(text);
      const topic: EmailIntent | "all" = /\b(?:recruiters?|recruiting)\b/i.test(core) ? "recruiter" : RECEIPT_WORDS.test(core) ? "receipt" : /\b(?:promotions?|promotional|deals?)\b/i.test(core) ? "promotion" : "all";
      return { kind: "default_window", topic, days };
    }
  }
  if (REMEMBER.test(text) && /\b(?:amounts?|totals?)\b/i.test(text) && RECEIPT_WORDS.test(text)) return { kind: "default_action", topic: "receipt", action: "amounts" };
  if (last?.sender) {
    const match = text.match(/^(?:no[,.!]?\s+)?(?:i meant|i mean|meant|it'?s|it is|should be|i said)\s+([\p{L}\p{N}&'.-]+(?:\s+[\p{L}\p{N}&'.-]+){0,2})[.!?]*$/iu)
      ?? text.match(/^no[,.!]\s*([\p{L}\p{N}&'.-]+(?:\s+[\p{L}\p{N}&'.-]+){0,2})[.!?]*$/iu);
    const canonical = match?.[1]?.trim().replace(/[.!?]+$/, "");
    if (canonical && !/\b(?:receipts?|invoices?|amounts?|totals?|emails?|mails?|orders?|statements?|promotions?|promotional|recruiters?|unread|days?|weeks?|months?)\b/i.test(canonical) && canonical.toLowerCase() !== last.sender.toLowerCase() && !/^(?:thanks?|thank you|problem|way|worries|need|more|please|cancel|stop|wait|nevermind|never mind|nothing|sorry|later|now|yet|really|sure|thanks a lot)$/i.test(canonical)) {
      return { kind: "sender_alias", alias: last.sender, canonical };
    }
  }
  return null;
}

// R11.8: a request that says "emails", "messages" or "just list" wants the plain list, whatever was learned.
const PLAIN_LIST = /\b(?:emails?|mails?|messages?|just (?:list|show)|list (?:them|only)|no amounts?|without amounts?)\b/i;

/** Applies a learned default action to a request the interpreter read as a plain list. */
export function applyLearnedAction(request: EmailRequest, message: string, learnings: Learnings) {
  const learned = learnings.defaultActions[request.topic];
  if (request.action !== "list" || !learned || PLAIN_LIST.test(message)) return { request, applied: false };
  return { request: { ...request, action: learned }, applied: true };
}

/**
 * R11.8: an explicit correction that lands on the amounts list teaches that receipts mean amounts. The correction phrase is the evidence,
 * so it does not matter what the previous answer was (it may already have been amounts). Pure; the caller saves it.
 */
export function learnFromReinterpretation(_previous: EmailRequest | null, next: EmailRequest, isCorrection: boolean, learnings: Learnings = NO_LEARNINGS): Learning | null {
  if (!isCorrection || next.action !== "amounts" || next.topic !== "receipt") return null;
  return learnings.defaultActions.receipt === "amounts" ? null : { kind: "default_action", topic: "receipt", action: "amounts" };
}
