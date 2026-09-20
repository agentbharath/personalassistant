import { EMAIL_NOUNS, parseEmailRequest, renderEmailRequest, type EmailRequest } from "./email-request";
import { PERIOD_PATTERN, extractRequestedSender, isCloseSpelling, isPlausibleSender, recencyDays } from "./email-query";
import type { EmailState } from "@/lib/conversations/email-state";

type ContextMessage = { role: "user" | "assistant"; content: string };

const MAX_FRAGMENT_LENGTH = 60;
const LEAD = String.raw`(?:(?:i mean|actually|and|also|but|now|then)[,\s]+)*`;
// A fragment starts with a follow-up marker, a period/unread word, or "import them". A full request starts with a verb (find, show, did…).
const MARKER = new RegExp(String.raw`^${LEAD}(?:(?:how|hoe|what)\s+(?:about|abt)|only|just|from|for|in|within|since)\b`, "i");
const PERIOD_START = /^(?:last|past|this week|today|yesterday|unread)\b/i;
const IMPORT_THEM = /^(?:(?:yes|yeah|yep|ok|okay|sure|please)[,.!\s]+)*(?:i mean\s+)?import\s+(?:them|those|these|it|all of (?:them|those|these))\b/i;
const NAME = new RegExp(String.raw`^${LEAD}(?:(?:how|hoe|what)\s+(?:about|abt)|and|also)\s+(?:(?:from|for)\s+)?([\p{L}\p{N}&'_-]+(?:\s+[\p{L}\p{N}&'_-]+){0,2})$`, "iu");

// With saved state (R5.7) a bare name of one to three words is a sender swap: "netflix?".
const BARE_NAME = /^[\p{L}\p{N}&'.-]+(?:\s+[\p{L}\p{N}&'.-]+){0,2}\??$/u;
const NOT_A_NAME = /^(?:why|how|what|when|where|who|which|ok|okay|yes|yeah|yep|no|nope|sure|thanks?|thank|please|more|again|retry|stop|cancel|confirm|hello|hi|hey|help|cool|nice|great|awesome|wow|hmm|huh|done|next|continue|go|calendar|meeting|meetings|spending|spent|weather|today|tomorrow|yesterday|search|searching|look|go|back|find|show|list|get|check|expand|widen|longer|further|older|earlier)\b/i;

function isBareName(text: string) {
  if (text.length > 30 || !BARE_NAME.test(text) || NOT_A_NAME.test(text)) return false;
  const parsed = parseEmailRequest(text);
  return parsed.topic === "general" && parsed.sender === null && parsed.days === null && parsed.calendar === null && !parsed.unread && !/\d/.test(text) && isPlausibleSender(text.replace(/[?.!]+$/, ""));
}

const PERIOD_FILLER = new Set(["and", "then", "also", "only", "just", "please", "search", "searching", "look", "looking", "go", "going", "back", "for", "the", "in", "over", "within", "last", "past", "previous", "what", "about", "how", "try", "now", "again", "from", "expand", "to", "up", "further", "earlier", "older", "me", "it", "let", "s", "lets", "ok", "okay", "yes", "yeah", "sure", "do"]);

/** "search 90 days", "90 days", "go back a year": a message that is only a window. A full question that mentions one is not a fragment. */
function isPeriodOnly(text: string) {
  if (recencyDays(text) === null) return false;
  const rest = text.replace(new RegExp(String.raw`\b${PERIOD_PATTERN}\b`, "gi"), " ").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return rest.every((word) => PERIOD_FILLER.has(word));
}

function isFragment(text: string) {
  return text.length <= MAX_FRAGMENT_LENGTH && (MARKER.test(text) || PERIOD_START.test(text) || isPeriodOnly(text) || IMPORT_THEM.test(text) || NAME.test(cleanForName(text)));
}

function cleanForName(text: string) {
  return text.replace(/\b(?:any|some)?\s*(?:emails?|mails?|messages?)\b/gi, " ").replace(/[?.!,]+/g, " ").replace(/\s+/g, " ").trim();
}

function isEmailRequest(request: EmailRequest, text: string) {
  return request.topic !== "general" || request.sender !== null || request.action !== "list" || EMAIL_NOUNS.test(text);
}

function knownSenderWords(context: ContextMessage[]) {
  const words = new Set<string>();
  for (const message of context) {
    const names = message.role === "user"
      ? [extractRequestedSender(message.content)]
      : [...message.content.matchAll(/([A-Z][\p{L}\p{N}&'. -]{2,40}?)\s*<[^>]+@/gu)].map((match) => match[1]);
    for (const name of names) for (const word of (name ?? "").split(/\s+/)) if (word.length >= 4) words.add(word);
  }
  return [...words];
}

const DID_NOT_MEAN = /^(?:no[,.!]?\s*)?(?:i\s+)?(?:did\s*n['’]?t|did not)\s+mean\b(.*)$/i;
const MEANT = /^(?:no[,.!]?\s*)?(?:i\s+)?(?:meant|mean|want(?:ed)?|need(?:ed)?)\s+(.+)$/i;
const MEANT_AFTER = /(?:[,.;]|\bbut\b)\s*(?:i\s+)?(?:meant|mean|want(?:ed)?|need(?:ed)?)\s+(.+)$/i;

/** R5.8: "I meant the amount receipts" / "I didn't mean X, I meant Y" → what the user actually asked for, or null. */
export function extractCorrectedRequest(text: string) {
  const negated = text.match(DID_NOT_MEAN);
  const target = negated ? negated[1].match(MEANT_AFTER)?.[1] : text.match(MEANT)?.[1];
  return target ? target.trim().replace(/[.!?]+$/, "") : null;
}

/** Applies one fragment to a request. Returns null when the fragment names nothing to change. */
function applyFragment(base: EmailRequest, text: string, known: string[]): EmailRequest | null {
  const next = { ...base };
  let changed = false;
  if (IMPORT_THEM.test(text)) {
    next.action = /\b(?:them|those|these|all)\b/i.test(text) ? "import_all" : "import";
    next.topic = "receipt";
    return next;
  }
  const fragment = parseEmailRequest(text);
  const hasWindow = fragment.days !== null || fragment.calendar !== null;
  if (hasWindow) { next.days = fragment.days; next.calendar = fragment.calendar; changed = true; }
  if (fragment.unread) { next.unread = true; changed = true; }
  if (fragment.topic !== "general") { next.topic = fragment.topic; changed = true; }
  if (fragment.action === "amounts" || fragment.action === "facts") { next.action = fragment.action; changed = true; }
  // A sender is either explicit ("from X") or, when the fragment has no period, the name in "how about X".
  const named = extractRequestedSender(text) ?? (hasWindow ? null : cleanForName(text).match(NAME)?.[1] ?? (isBareName(text) ? text.replace(/[?.!]+$/, "").trim() : null));
  if (named && isPlausibleSender(named)) {
    next.sender = named.split(/\s+/).length === 1 ? known.find((word) => word.toLowerCase() !== named.toLowerCase() && isCloseSpelling(word, named)) ?? named : named;
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Turns a fragment ("from. last one month", "only unread", "how about netflix", "import them") into a full, standalone
 * request by editing the structured previous request. Standalone questions are never rewritten.
 */
export function resolveEmailFollowUp(input: string, context: ContextMessage[], state: EmailState | null = null) {
  const text = input.trim();
  const known = knownSenderWords(context);
  // R5.7: saved state is the context. Only when it is missing do we re-read the messages.
  if (state) {
    const corrected = extractCorrectedRequest(text);
    const target = corrected ?? text;
    if (corrected === null && !isFragment(text) && !isBareName(text)) return null;
    if (corrected !== null) {
      const meant = parseEmailRequest(corrected);
      const says = meant.action !== "list" || meant.topic !== "general" || meant.days !== null || meant.calendar !== null || meant.unread || meant.sender !== null;
      if (!says) return null;
    }
    const applied = applyFragment(state.request, target, [...known, ...state.results.flatMap((result) => result.from.replace(/<[^>]*>/, "").split(/\s+/)).filter((word) => word.length >= 4)]);
    return applied ? renderEmailRequest(applied) : null;
  }
  if (!isFragment(text)) return null;
  const fragments: string[] = [];
  for (const message of [...context].reverse().filter((item) => item.role === "user").slice(0, 8)) {
    const content = message.content.trim();
    if (isFragment(content)) { fragments.unshift(content); continue; }
    const parsed = parseEmailRequest(content);
    if (!isEmailRequest(parsed, content)) return null;
    let request: EmailRequest = parsed;
    for (const fragment of [...fragments, text]) {
      const applied = applyFragment(request, fragment, known);
      if (applied) request = applied;
      else if (fragment === text) return null;
    }
    return renderEmailRequest(request);
  }
  return null;
}
