import { ONE_TIME_MAIL_NOTE, isOneTimeSecretMail, redactSecrets } from "./email-secrets";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { composeNoResultReply, extractTransactionFromEvidence, type NoResultFacts } from "@/lib/model/claude";
import { saveEmailState, type EmailState } from "@/lib/conversations/email-state";
import { NO_LEARNINGS, applyLearnings, describeSearch, type Learnings } from "@/lib/learning/learnings";
import { loadLearnings } from "@/lib/learning/store";
import { GoogleGmailAccessError, readGmailAttachment, readGmailMessage, searchGmail } from "@/lib/tools/email/google-gmail";
import { Temporal } from "@js-temporal/polyfill";
import { asksForInvoiceFacts, extractInvoiceFacts } from "./email-invoice";
import { exclusionTerms, extractRequestedSender, fixDomainTypos, isCloseSpelling, stripExclusions, toGmailQuery } from "./email-query";
import { HUMANS_ONLY, mentionsAll, parseEmailRequest, type EmailRequest } from "./email-request";
import { detectEmailIntent, emailIntentRelevance, minimumEmailRelevance } from "./email-relevance";

const AUTOMATED_SENDER = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|mailer-daemon|newsletter|news|info|support|team|hello|mail|updates?)\b/;

export type EmailSearchOutcome = { answer: string; request: EmailRequest; results: EmailState["results"] };
type EmailOptions = { conversationId?: string; learnings?: Learnings };

export async function answerEmail(rawInput: string, userId: string, options: EmailOptions = {}) {
  return (await searchEmail(rawInput, userId, options)).answer;
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Puts a default window before any trailing exclusion clause, so the clause still parses as an exclusion. */
function withWindow(text: string, days: number) {
  const { core, clause } = stripExclusions(text);
  return clause ? `${core} last ${days} days, ${clause}` : `${text.replace(/[?.!]+$/, "")} last ${days} days`;
}

const CORRECTION_HINT = "_Not what you meant? Say “I meant …” or “search 90 days”, or “always search 90 days” and I’ll remember._";

export async function searchEmail(rawInput: string, userId: string, options: EmailOptions = {}): Promise<EmailSearchOutcome> {
  const fixed = fixDomainTypos(rawInput);
  const parsed = parseEmailRequest(fixed);
  const learnings = options.learnings ?? await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const applied = applyLearnings(parsed, learnings, { everything: mentionsAll(fixed) });
  let learnedInput = fixed;
  if (applied.aliasedFrom && applied.request.sender) learnedInput = learnedInput.replace(new RegExp(escapeRegExp(applied.aliasedFrom), "i"), applied.request.sender);
  if (parsed.days === null && parsed.calendar === null && applied.request.days) learnedInput = withWindow(learnedInput, applied.request.days);
  const terms = describeSearch(applied.request, applied.defaultedWindow);
  const footer = `_Searched: ${escapeMarkdown(terms)}._`;
  const outcome = async (answer: string, results: EmailState["results"] = []): Promise<EmailSearchOutcome> => {
    // R5.7: the default window is left unset in saved state so a learned default is re-applied on the next turn.
    const request = { ...applied.request, days: applied.defaultedWindow ? null : applied.request.days };
    if (options.conversationId) await saveEmailState(userId, options.conversationId, { request, results });
    return { answer, request, results };
  };
  try {
    const input = learnedInput;
    const query = toGmailQuery(input);
    const requestedSender = extractRequestedSender(input);
    const intent = detectEmailIntent(input);
    const timeZone = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
    const excluded = exclusionTerms(input, requestedSender);
    const humansOnly = HUMANS_ONLY.test(input);
    // "related" = right sender and window but rejected as the wrong kind of mail (e.g. promos when asked for invoices).
    let related: Awaited<ReturnType<typeof searchGmail>> = [];
    const refine = (candidates: Awaited<ReturnType<typeof searchGmail>>, ignoreDate = false) => {
      const scoped = candidates
        .filter((message) => !requestedSender || senderMatches(message.from, requestedSender))
        .filter((message) => !humansOnly || !AUTOMATED_SENDER.test(senderAddress(message.from)))
        .filter((message) => !excluded.some((term) => `${message.subject} ${message.snippet}`.toLowerCase().includes(term)))
        .filter((message) => ignoreDate || matchesRequestedDate(message.receivedAt, input, timeZone));
      const scored = scoped.map((message) => ({ message, relevance: emailIntentRelevance(message, intent) }));
      if (requestedSender) related = deduplicateThreads(scoped.filter((message) => !scored.some((item) => item.message === message && item.relevance >= minimumEmailRelevance(intent))));
      const ranked = deduplicateThreads(scored
        .filter(({ relevance }) => relevance >= minimumEmailRelevance(intent))
        .sort((left, right) => right.relevance - left.relevance || confirmationRank(right.message) - confirmationRank(left.message) || right.message.receivedAt - left.message.receivedAt)
        .map(({ message }) => message));
      return intent === "receipt" ? deduplicateOrders(ranked) : ranked;
    };
    // R4.6: receipt searches look at up to 50 candidates instead of Gmail's default 20 newest.
    const candidates = intent === "receipt" ? 50 : 20;
    let messages = refine(await searchGmail(userId, query, candidates));
    // Gmail can't match a misspelled sender ("adobee"), so retry broadly and match the sender fuzzily.
    if (!messages.length && requestedSender && requestedSender.length >= 4) {
      messages = refine(await searchGmail(userId, toGmailQuery(input, timeZone, { ignoreSender: true }), candidates));
    }
    const isFacts = applied.request.action === "facts";
    const windowLabel = applied.request.days ? `the last ${applied.request.days} days` : applied.request.calendar;
    let widenedNote = "";
    let outside: typeof messages = [];
    if (!messages.length && windowLabel) {
      // R6.1, R11.3: nothing in the window, so look back up to a year.
      outside = refine(await searchGmail(userId, toGmailQuery(input, timeZone, { ignoreDate: true }), candidates), true);
      if (outside.length && isFacts) {
        messages = outside;
        widenedNote = `Nothing in ${windowLabel}, so I went further back. `;
      }
    }
    if (!messages.length) {
      const nearMiss = outside[0] ?? related[0] ?? null;
      const facts: NoResultFacts = {
        kind: outside.length ? "outside_window" : related.length ? "wrong_kind" : "nothing",
        terms,
        sender: applied.request.sender,
        window: windowLabel,
        defaulted: applied.defaultedWindow,
        nearMiss: nearMiss ? { subject: nearMiss.subject, from: nearMiss.from, date: formatDate(nearMiss.date) } : null,
      };
      const voice = await composeNoResultReply(facts).then((text) => (text && text.length <= 600 && !/connected gmail account|claude|anthropic/i.test(text) ? text : fallbackNoResult(facts))).catch(() => fallbackNoResult(facts));
      return outcome([voice, nearMiss ? describeMessage(nearMiss) : "", footer, CORRECTION_HINT].filter(Boolean).join("\n\n"));
    }
    // R13.7: a plural receipt request that asks for amounts lists each receipt with its amount and date.
    if (applied.request.action === "amounts") {
      const shown = messages.slice(0, 5);
      const emails = await Promise.all(shown.map((message) => readGmailMessage(userId, message.id)));
      const read = emails.map((email) => ({ email, facts: extractInvoiceFacts(email) }));
      const rows = read.map(({ email, facts }, index) => `${index + 1}. **${escapeMarkdown(email.subject)}**  \n   ${facts.amount ?? "amount not in the email text"} · ${facts.billingDate ?? formatDate(email.date)}`);
      const cents = read.map(({ facts }) => (facts.amount ? Math.round(Number.parseFloat(facts.amount.replace(/[$,]/g, "")) * 100) : null));
      const total = cents.length > 1 && cents.every((value) => value !== null) ? `\n\n**Total: $${((cents as number[]).reduce((sum, value) => sum + value, 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**` : "";
      return outcome([`### Receipt amounts\n\n${rows.join("\n")}${total}`, footer, applied.defaultedWindow ? CORRECTION_HINT : ""].filter(Boolean).join("\n\n"), shown.map((message) => ({ id: message.id, subject: message.subject, from: message.from, date: message.date })));
    }
    if (isFacts) {
      const { text, found } = await invoiceFactsForMessage(userId, messages[0].id, timeZone, widenedNote);
      return outcome([text, footer].join("\n\n"), found);
    }
    // R13.1: results are numbered so "the second one" has something to point at.
    const rows = messages.slice(0, 5).map((message, index) => {
      const date = formatDate(message.date);
      const detail = [message.from, date].filter(Boolean).join(" · ");
      return `${index + 1}. **${escapeMarkdown(message.subject)}**  \n   ${escapeMarkdown(detail)}${message.snippet && !isOneTimeSecretMail(message.subject, message.snippet) ? `  \n   ${escapeMarkdown(redactSecrets(message.snippet.slice(0, 180)))}` : ""}`;
    });
    return outcome([`### Matching email\n\n${rows.join("\n")}`, footer, applied.defaultedWindow ? CORRECTION_HINT : ""].filter(Boolean).join("\n\n"), messages.slice(0, 5).map((message) => ({ id: message.id, subject: message.subject, from: message.from, date: message.date })));
  } catch (error) {
    const fail = (answer: string): EmailSearchOutcome => ({ answer, request: applied.request, results: [] });
    if (error instanceof GoogleConnectionRequiredError) return fail("Gmail read access is not connected yet. Sign out and continue with Google again, then approve the read-only Gmail permission.");
    if (error instanceof GoogleGmailAccessError) {
      if (error.reason === "api_disabled") return fail("The Gmail API is not enabled for this Google Cloud project. Enable Gmail API, wait a few minutes, and try again.");
      if (error.reason === "insufficient_scope") return fail("The current Google connection does not include Gmail read access. Sign out, reconnect with Google, and approve the Gmail permission.");
      if (error.reason === "forbidden") return fail("Google denied Gmail access. Confirm this account is an approved OAuth test user.");
      return fail("Gmail is temporarily unavailable. Nothing was changed; please try again shortly.");
    }
    throw error;
  }
}

/** Amount and billing date for one email. Shared by the search path and by "how much was the first one" (R13.2). */
export async function invoiceFactsForMessage(userId: string, messageId: string, timeZone: string, widenedNote = "") {
  const email = await readGmailMessage(userId, messageId);
  const facts = extractInvoiceFacts(email);
  if (!facts.amount || !facts.billingDate) Object.assign(facts, await fillFromAttachment(userId, email, facts, timeZone));
  const source = `${escapeMarkdown(email.subject)} — ${escapeMarkdown(email.from)}${formatDate(email.date) ? ` · received ${formatDate(email.date)}` : ""}`;
  const found = [{ id: email.id, subject: email.subject, from: email.from, date: email.date }];
  if (!facts.amount && !facts.billingDate) return { text: `${widenedNote}I found **${source}**, but I couldn’t read an amount or billing date from the email or its attachment.`, found };
  return { text: `${widenedNote ? `${widenedNote}\n\n` : ""}### ${facts.amount ? "Invoice" : "Email"} details\n\n- **Amount:** ${facts.amount ?? "not stated in the email"}\n- **Billing date:** ${facts.billingDate ?? "not stated in the email"}\n- **Source:** ${source}`, found };
}

/** R13.2: show one email. Deterministic and read-only. */
export async function showEmailMessage(userId: string, messageId: string) {
  const email = await readGmailMessage(userId, messageId);
  const date = formatDate(email.date);
  const heading = `### ${escapeMarkdown(email.subject)}\n\n**From:** ${escapeMarkdown(email.from)}${date ? `  \n**Date:** ${date}` : ""}`;
  // R24: a one-time code or sign-in email is not shown at all, and anything secret-looking in another email is hidden.
  if (isOneTimeSecretMail(email.subject, email.snippet || email.text)) return `${heading}\n\n${ONE_TIME_MAIL_NOTE}`;
  const body = redactSecrets(email.text.replace(/\[link\]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 900);
  return `${heading}\n\n${escapeMarkdown(body || redactSecrets(email.snippet))}${email.text.length > 900 ? "…" : ""}`;
}

const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

// Model fallback, only when the email body lacked the amount or date. Fails soft to the body-only answer.
async function fillFromAttachment(userId: string, email: Awaited<ReturnType<typeof readGmailMessage>>, facts: ReturnType<typeof extractInvoiceFacts>, timeZone: string) {
  const metadata = email.attachments.find((item) => (ATTACHMENT_TYPES as readonly string[]).includes(item.mimeType) && item.size <= 5_000_000);
  if (!metadata) return {};
  try {
    const attachment = await readGmailAttachment(userId, email.id, metadata.id);
    const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate().toString();
    const extracted = await extractTransactionFromEvidence(
      [`Subject: ${email.subject}`, `From: ${email.from}`, `Received: ${email.date}`, `Snippet: ${email.snippet}`].join("\n"),
      today,
      { data: attachment.data.replaceAll("-", "+").replaceAll("_", "/"), mediaType: metadata.mimeType as (typeof ATTACHMENT_TYPES)[number] },
    );
    if (!extracted.isTransaction) return {};
    return {
      amount: facts.amount ?? (extracted.amountMinor ? new Intl.NumberFormat("en-US", { style: "currency", currency: extracted.currency ?? "USD" }).format(extracted.amountMinor / 100) : null),
      billingDate: facts.billingDate ?? (extracted.occurredOn ? formatDate(`${extracted.occurredOn}T12:00:00Z`) : null),
    };
  } catch {
    return {};
  }
}

// Confirmation, shipping, and delivery mails share one order number; keep one row per order, preferring the confirmation.
export function orderKey(message: { subject: string; snippet: string }) {
  const text = `${message.subject} ${message.snippet}`;
  return text.match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0] ?? text.match(/(?:#|\border\s+(?:number\s+)?)\s*(\d{6,})/i)?.[1] ?? null;
}

export function confirmationRank(message: { subject: string }) {
  return /confirm|thank you for your|receipt|invoice/i.test(message.subject) ? 1 : 0;
}

export function deduplicateOrders<T extends { subject: string; snippet: string }>(messages: T[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = orderKey(message);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Used only when the model is unavailable. Still in Daylark's voice, never the old system sentence (R6.4). */
export function fallbackNoResult(facts: NoResultFacts) {
  const who = facts.sender ? ` from ${facts.sender}` : "";
  const when = facts.window ? ` in ${facts.window}` : "";
  if (facts.kind === "outside_window") return `Nothing${who}${when}${facts.defaulted ? ", which is as far back as I looked by default" : ""}. The most recent one is below—want me to search further back?`;
  if (facts.kind === "wrong_kind") return `There's mail${who}${when}, but none of it looks like what you asked for. The closest is below—is that the kind of thing you meant?`;
  return `Nothing turned up${who}${when}. ${facts.sender ? `Could ${facts.sender} be spelled differently, or is it a different name?` : "Want me to try a wider window or different words?"}`;
}

function describeMessage(message: { subject: string; from: string; date: string }) {
  const date = formatDate(message.date);
  return `- **${escapeMarkdown(message.subject)}**  \n  ${escapeMarkdown([message.from, date].filter(Boolean).join(" · "))}`;
}

function senderAddress(from: string) {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).toLowerCase();
}

export function senderMatches(actualSender: string, requestedSender: string) {
  const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  const actual = normalize(actualSender);
  const requested = normalize(requestedSender);
  if (!requested) return true;
  if (actual.includes(requested)) return true;
  const compactActual = actual.replaceAll(" ", "");
  const compactRequested = requested.replaceAll(" ", "");
  if (compactRequested.length >= 3 && compactActual.includes(compactRequested)) return true;
  return actual.split(" ").some((word) => isCloseSpelling(word, requested));
}

function deduplicateThreads<T extends { threadId: string }>(messages: T[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.threadId)) return false;
    seen.add(message.threadId);
    return true;
  });
}

export function matchesRequestedDate(receivedAt: number, input: string, timeZone: string) {
  if (!/\b(today|yesterday|this week)\b/i.test(input)) return true;
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return false;
  const received = Temporal.Instant.fromEpochMilliseconds(receivedAt).toZonedDateTimeISO(timeZone).toPlainDate();
  const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  if (/\btoday\b/i.test(input)) return Temporal.PlainDate.compare(received, today) === 0;
  if (/\byesterday\b/i.test(input)) return Temporal.PlainDate.compare(received, today.subtract({ days: 1 })) === 0;
  const weekStart = today.subtract({ days: today.dayOfWeek - 1 });
  return Temporal.PlainDate.compare(received, weekStart) >= 0 && Temporal.PlainDate.compare(received, today) <= 0;
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function escapeMarkdown(value: string) { return value.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1"); }
