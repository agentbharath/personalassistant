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
    request.intent || (request.searchTerms?.length ? request.searchTerms.join(" / ") : facts || TOPIC_LABEL[request.topic]),
    request.sender ? `from ${request.sender}` : "",
    window,
    request.unread ? "unread only" : "",
    request.humansOnly ? "real people only" : "",
    request.exclusion ? `excluding: ${request.exclusion.replace(/^(?:skip|exclude|excluding|except|without|ignore|ignoring|not|no)\s+/i, "").replace(/[.?!]+$/, "")}` : "",
  ].filter(Boolean).join(" · ");
}

/** Applies a learned default action to a request the interpreter read as a list, unless the person asked for the emails themselves (`plainList`, read by the model). */
export function applyLearnedAction(request: EmailRequest, plainList: boolean, learnings: Learnings) {
  const learned = learnings.defaultActions[request.topic];
  if (request.action !== "list" || !learned || plainList) return { request, applied: false };
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
