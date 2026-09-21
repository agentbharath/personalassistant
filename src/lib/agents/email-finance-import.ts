import { Temporal } from "@js-temporal/polyfill";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { extractTransactionFromEvidence, type ExtractedTransaction } from "@/lib/model/claude";
import { buildEvidence, describeMissingTotal, extractInvoiceFacts } from "./email-invoice";
import { confirmationRank, deduplicateOrders, senderMatches } from "./email";
import { saveEmailState } from "@/lib/conversations/email-state";
import { NO_LEARNINGS, applyLearnings, describeSearch } from "@/lib/learning/learnings";
import { createInterpretationCache } from "./email-interpreter-runtime";
import { applyMerchantLearnings, guessCategory } from "@/lib/learning/preferences";
import { listBills } from "@/lib/tools/finance/bills";
import { groundAmount } from "./amount-grounding";
import { previewDuplicate } from "@/lib/tools/finance/transactions";
import { classifyDocument, extractDueDate, matchPayment, type Bill, type DocumentKind } from "./bills";
import { loadLearnings } from "@/lib/learning/store";
import { mentionsAll, parseEmailRequest } from "./email-request";
import { STRONG_RECEIPT_SUBJECT, emailIntentRelevance, minimumEmailRelevance } from "./email-relevance";
import { GoogleGmailAccessError, readGmailAttachment, readGmailMessage, searchGmail } from "@/lib/tools/email/google-gmail";
import { createFinanceImportApproval } from "@/lib/workflows/finance-import";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export async function prepareEmailFinanceImport(input: string, userId: string, conversationId?: string) {
  if (!conversationId) return "I can’t create a durable approval without a saved conversation. Please start a new chat and try again.";
  if (/\b(?:all|every|each)\b/i.test(input)) return prepareBulkEmailImport(input, userId, conversationId);
  await saveEmailState(userId, conversationId, { request: parseEmailRequest(input), results: [] });
  try {
    const messages = await searchGmail(userId, buildImportQuery(input));
    if (!messages.length) return "I couldn’t find a matching receipt, invoice, order, or bill in Gmail.";
    const ranked = rankImportMessages(messages, input);
    const selected = ranked[0];
    if (!selected || documentScore(selected, input) < minimumDocumentScore(input)) {
      return `I found related email, but none looked like an actual payable statement or purchase receipt. Nothing was imported.${selected ? `\n\nClosest match: **${selected.subject.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1")}**` : ""}`;
    }
    return await previewImportFromMessage(userId, conversationId, selected.id, input, false);
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError) return "Gmail read access is not connected. Reconnect Google and approve read-only Gmail access.";
    if (error instanceof GoogleGmailAccessError) return "Gmail could not be read right now. Nothing was imported; please try again shortly.";
    throw error;
  }
}

/** R13.5: import one specific email the user pointed at. Approval is still required. */
export async function prepareImportForMessage(userId: string, conversationId: string | undefined, messageId: string, input = "import this receipt") {
  if (!conversationId) return "I can’t create a durable approval without a saved conversation. Please start a new chat and try again.";
  try {
    return await previewImportFromMessage(userId, conversationId, messageId, input, true);
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError) return "Gmail read access is not connected. Reconnect Google and approve read-only Gmail access.";
    if (error instanceof GoogleGmailAccessError) return "Gmail could not be read right now. Nothing was imported; please try again shortly.";
    throw error;
  }
}

async function previewImportFromMessage(userId: string, conversationId: string, messageId: string, input: string, explicit: boolean) {
  const email = await readGmailMessage(userId, messageId);
  const evidence = buildEvidence(email);
  // R13.5: when the user pointed at this email, the receipt heuristics are skipped; the model check below still applies.
  if (!explicit && !isLikelyRequestedDocument(email, input)) {
    return `I found **${email.subject}**, but it appears to be an informational notice rather than the requested statement or receipt. Nothing was imported.`;
  }
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
  const attachmentMetadata = email.attachments.find((attachment) => isSupportedAttachment(attachment.mimeType) && attachment.size <= 5_000_000);
  const attachment = attachmentMetadata
    ? await readGmailAttachment(userId, email.id, attachmentMetadata.id)
    : null;
  const extracted = await extractForEmail(userId, email, evidence, today, attachment && attachmentMetadata ? {
    data: attachment.data,
    mediaType: attachmentMetadata.mimeType as "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
  } : undefined);
  // Amounts read from an attached PDF or photo cannot be checked against the email text, so only email text is checked.
  if (!attachment) extracted.amountMinor = groundAmount(extracted.amountMinor, `${email.subject} ${email.snippet} ${email.text}`, factAmountMinor(email)) ?? 0;
  const missing = [!extracted.amountMinor && "amount", !extracted.merchant && "merchant", !extracted.occurredOn && "date"].filter(Boolean);
  if (!extracted.isTransaction || missing.length) {
    return `I found **${email.subject}**, but I couldn’t reliably identify the ${joinWords(missing.length ? missing as string[] : ["transaction details"])}. Nothing was imported.`;
  }
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const learned = applyMerchantLearnings({
    occurredOn: orderPlacedOn(email) ?? extracted.occurredOn!,
    amountMinor: extracted.amountMinor!,
    currency: extracted.currency ?? "USD",
    direction: isCardPayment(email) ? "transfer" as const : extracted.direction ?? "expense" as const,
    merchant: extracted.merchant!,
    category: extracted.category ?? "other",
    note: extracted.note,
  }, learnings);
  const candidate = learned.candidate;
  const outstanding = await listBills(userId, "outstanding").catch(() => [] as Bill[]);
  const decided = decideImportKind(classifyDocument(email.subject), email, candidate, outstanding);
  await createFinanceImportApproval(userId, conversationId, {
    candidate,
    source: {
      type: "email",
      externalRef: email.id,
      payload: JSON.stringify({ subject: email.subject, from: email.from, date: email.date }),
    },
    ...(decided.kind === "expense" ? {} : { kind: decided.kind, billId: decided.billId, dueOn: decided.dueOn }),
  });
  if (decided.kind === "bill") {
    return `### Review bill\n\n- **From:** ${candidate.merchant}\n- **Amount due:** ${formatMoney(candidate.amountMinor, candidate.currency)}\n- **Billed:** ${candidate.occurredOn}\n- **Due:** ${decided.dueOn ?? "not stated in the email"}\n- **Source:** ${email.subject}\n\nThis is a bill, so it **won’t count as spending until it’s paid**. Choose **Confirm** to record it, or **Cancel**. This preview expires in 30 minutes.`;
  }
  if (decided.kind === "payment" && decided.pays) {
    return `### Review payment\n\n- **This pays your ${decided.pays.merchant} bill** of ${formatMoney(decided.pays.amountMinor, decided.pays.currency)} (billed ${decided.pays.statementDate}).\n- **Paid:** ${formatMoney(candidate.amountMinor, candidate.currency)} on ${candidate.occurredOn}\n- **Source:** ${email.subject}\n\nChoose **Confirm** to mark the bill paid. It will then count as spending once, dated on the payment. Or **Cancel**. This preview expires in 30 minutes.`;
  }
  return `### Review email import\n\n- **Merchant:** ${candidate.merchant}\n- **Amount:** ${formatMoney(candidate.amountMinor, candidate.currency)}\n- **Date:** ${candidate.occurredOn}\n- **Category:** ${candidate.category}${learned.recategorized ? " (from your earlier correction)" : ""}\n- **Source:** ${email.subject}\n\nChoose **Confirm** to import it or **Cancel** to leave your finances unchanged. This preview expires in 30 minutes.`;
}

function buildImportQuery(input: string) {
  const entity = input.match(/\b(?:latest|recent)\s+(.+?)\s+(?:receipts?|invoices?|orders?|bills?|statements?)\b/i)?.[1]
    ?? input.match(/\bfrom\s+(.+?)(?=\s+(?:in|during|within|over|since|before|after|last|past)\b|[?.!,]|$)/i)?.[1];
  const typeTerms = /\b(receipt|invoice|order|bill|statement)s?\b/i.exec(input)?.[1];
  if (entity) return `"${entity.replaceAll('"', "")}" ${typeTerms ? `{${typeTerms} receipt invoice bill statement order}` : "{receipt invoice bill statement order}"}`;
  const terms = input.replace(/\b(import|record|add|save|my|latest|recent|email|emails|gmail|from|the)\b/gi, " ").replace(/\s+/g, " ").trim();
  return terms || "{receipt invoice bill statement order} newer_than:90d";
}

function rankImportMessages<T extends { subject: string; snippet: string; receivedAt: number }>(messages: T[], input: string) {
  return [...messages].sort((left, right) => documentScore(right, input) - documentScore(left, input) || right.receivedAt - left.receivedAt);
}

// Paying a card bill is a transfer, not spending (owner decision 2026-09-21): a card issuer's "we received your payment" is imported as a card payment that
// settles the card bill and is left out of every spending total. A card issuer's statement is still not imported as spending.
const CARD_ISSUER = /(?:chase|capitalone|americanexpress|amex|discover|citi|bankofamerica|wellsfargo|synchrony|barclays|usbank|applecard)/i;

/** A credit card issuer's payment notice: the payment on a card bill. It is recorded as a transfer, never as spending. */
export function isCardPayment(email: { from: string; subject: string }) {
  return CARD_ISSUER.test(email.from.split("<").at(-1) ?? email.from) && classifyDocument(email.subject) === "payment";
}

export function documentScore(message: { subject: string; snippet: string; from?: string }, input: string) {
  const subject = message.subject.toLowerCase();
  const text = `${message.subject} ${message.snippet}`.toLowerCase();
  let score = 0;
  if (/\b(bills?|statements?)\b/i.test(input)) {
    if (/energy statement is ready|statement (?:is )?ready|bill (?:is )?ready|monthly statement|billing statement/.test(subject)) score += 12;
    if (/amount due|payment due|due date|total due|statement date|billing period/.test(text)) score += 7;
    if (/\b(statement|invoice)\b/.test(subject)) score += 4;
    if (/\bbill\b/.test(subject)) score += 2;
  }
  if (/\b(receipts?|orders?|purchases?|invoices?|payments?)\b/i.test(input)) {
    if (/\b(receipt|invoice|order confirmation|payment confirmation)\b/.test(subject) || STRONG_RECEIPT_SUBJECT.test(subject)) score += 10;
    // A payment notice ("thank you for your payment", "your payment posted") is a payment record, including a credit card bill payment.
    if (classifyDocument(message.subject) === "payment") score += 10;
    // Amazon-style "Ordered: <item>" lifecycle subjects are the purchase record.
    if (/^\W*ordered\b/.test(subject)) score += 8;
    if (/order total|total paid|payment received|amount paid/.test(text)) score += 6;
    // Store mail often says only "Thank you for your <store> order 947597212": an order number is the evidence.
    if (score < 10 && /\border\b/.test(subject) && (/\b(?:order|#)\s*#?\s*(?=[a-z0-9-]*\d)[a-z0-9-]{5,}/.test(text) || /\b(?:thank you for your|your)\b[^.]*\border\b/.test(subject))) score += 8;
    // R4.4: shipped/delivered notices are not receipts.
    if (/\b(?:shipped|delivered|out for delivery)\b/.test(subject)) score -= 15;
  }
  if (/\d+\s?% off|coupon|\bdeals?\b|\bsale\b|shop now|limited time/.test(subject)) score -= 15;
  // R17.4: a card issuer's statement or payment notice is a transfer or a liability, never spending. The purchases on it are the spending.
  if (message.from && CARD_ISSUER.test(message.from.split("<").at(-1) ?? message.from) && classifyDocument(message.subject) === "bill") score -= 15;
  if (/climate credit|bill relief|cap-and-invest|town hall|newsletter|safety|tips|program/.test(subject)) score -= 15;
  return score;
}

export function minimumDocumentScore(input: string) {
  return /\b(bills?|statements?)\b/i.test(input) ? 6 : 5;
}

export function isLikelyRequestedDocument(email: { subject: string; snippet: string; text: string }, input: string) {
  const subject = email.subject.toLowerCase();
  const content = `${email.subject} ${email.snippet} ${email.text}`.toLowerCase();
  if (/climate credit|bill relief|cap-and-invest|town hall|newsletter|safety|tips|program/.test(subject)) return false;
  if (classifyDocument(email.subject) === "payment" && !/\b(bills?|statements?)\b/i.test(input)) return true;
  if (/\b(bills?|statements?)\b/i.test(input)) {
    return /energy statement is ready|statement (?:is )?ready|amount due|payment due|total due|due date|billing period|statement date/.test(content);
  }
  if (/receipt|invoice|order total|order summary|grand total|total paid|payment received|amount paid|order confirmation|booking confirm|reservation confirm|total price/.test(content)) return true;
  // A store order email with an order number and a dollar amount is a purchase record even without the word "receipt".
  return /\border\b/.test(content) && /\$\s?\d[\d,]*\.\d{2}/.test(content);
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}
function joinWords(values: string[]) { return values.length < 2 ? values[0] : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`; }
/** The total the plain rules find in the email, in cents, or null. */
function factAmountMinor(email: Parameters<typeof extractInvoiceFacts>[0]) {
  const facts = extractInvoiceFacts(email);
  return facts.amount ? Math.round(Number.parseFloat(facts.amount.replace(/[$,]/g, "")) * 100) : null;
}
function isSupportedAttachment(mimeType: string) { return ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mimeType); }

type BulkOutcome =
  | { kind: "item"; candidate: BulkCandidate["candidate"]; source: { type: "email"; externalRef: string; payload: string }; subject: string; usedEmailDate: boolean; documentKind: DocumentKind; dueOn: string | null; importKind: ImportKind["kind"]; billId?: string; pays?: Bill }
  | { kind: "skipped"; subject: string; reason: string };

const BULK_LIMIT = 12;

function describeFailure(reason: unknown) {
  const name = reason instanceof Error ? reason.name : "";
  if (name === "QueryBudgetUnavailableError") return "this request hit its model cost or time limit";
  if (name === "AbortError") return "it ran out of time";
  if (name === "GoogleGmailAccessError") return "Gmail didn’t respond";
  return name || "unknown error";
}

type BulkEmail = { subject: string; from: string; date: string; snippet: string; text: string };
export type BulkCandidate = { candidate: { occurredOn: string; amountMinor: number; currency: string; direction: "expense" | "income" | "transfer"; merchant: string; category: string; note?: string | null }; usedEmailDate: boolean };

/** Completes a model extraction with deterministic fallbacks, or says exactly why the email can't be imported. */
const GENERIC_TAIL = /\s+(?:orders?|receipts?|invoices?|billing|payments?|support|team|store|shop|notifications?|alerts?|customer (?:service|care)|no-?reply|do not reply|confirmations?|statements?)$/i;
const DOMAIN_NOISE = new Set(["mail", "email", "e", "em", "info", "billpay", "noreply", "no-reply", "notifications", "alerts", "orders", "order", "news", "updates", "account", "accounts", "service", "services", "www", "co", "com", "net", "org", "in", "uk"]);

/** "iHerb <noreply@info.iherb.com>" → "iHerb"; "DoorDash Order" → "DoorDash"; a bare address falls back to its company domain. */
export function senderDisplayName(from: string) {
  let name = from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  if (name.includes("@")) name = "";
  name = name.replace(/\.com$/i, "");
  while (GENERIC_TAIL.test(name)) name = name.replace(GENERIC_TAIL, "");
  if (name) return name;
  const domain = (from.match(/@([\w.-]+)/)?.[1] ?? "").toLowerCase();
  const label = domain.split(".").filter((part) => part && !DOMAIN_NOISE.has(part)).at(-1);
  return label ? label[0].toUpperCase() + label.slice(1) : "";
}

/**
 * R9.4, R16: an order confirmation with a readable total needs no model. Amount, date and merchant come straight from the email,
 * so the result is identical every time and costs no tokens. Returns null when anything is unclear, and the model is used instead.
 */
export function deterministicOrderExtraction(email: { subject: string; from: string; date: string; snippet: string; text: string }): ExtractedTransaction | null {
  const placedOn = orderPlacedOn(email);
  const amount = extractInvoiceFacts(email).amount;
  const merchant = senderDisplayName(email.from);
  if (!placedOn || !amount || !merchant) return null;
  const amountMinor = Math.round(Number.parseFloat(amount.replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  return { isTransaction: true, amountMinor, currency: "USD", direction: "expense", merchant, category: guessCategory(merchant) ?? "shopping", occurredOn: placedOn, note: null, missingFields: [] };
}

const extractionCache = createInterpretationCache();
const EXTRACTION_VERSION = "extract-v1";

/** Deterministic first; otherwise the model, cached per email so the same email is never read twice. */
async function extractForEmail(userId: string, email: Parameters<typeof deterministicOrderExtraction>[0] & { id: string }, evidence: string, today: string, attachment?: Parameters<typeof extractTransactionFromEvidence>[2]) {
  const direct = deterministicOrderExtraction(email);
  if (direct) return direct;
  const material = [EXTRACTION_VERSION, userId, email.id, attachment ? "attachment" : "body"].join(" || ");
  try {
    const cached = await extractionCache.get(material);
    if (cached) return JSON.parse(cached) as ExtractedTransaction;
  } catch { /* the cache is optional */ }
  const extracted = await extractTransactionFromEvidence(evidence, today, attachment);
  try { await extractionCache.set(material, JSON.stringify(extracted)); } catch { /* optional */ }
  return extracted;
}

export type ImportKind = { kind: "expense" | "bill" | "payment"; billId?: string; dueOn?: string | null; pays?: Bill };

/** R17.1, R17.4: a bill is stored as a bill; a payment settles the matching outstanding bill; everything else is an expense. */
export function decideImportKind(documentKind: DocumentKind, email: { text: string }, candidate: { merchant: string; amountMinor: number; occurredOn: string }, outstanding: Bill[]): ImportKind {
  if (documentKind === "bill") return { kind: "bill", dueOn: extractDueDate(email.text, candidate.occurredOn) };
  if (documentKind === "payment") {
    const bill = matchPayment(outstanding, { merchant: candidate.merchant, amountMinor: candidate.amountMinor, date: candidate.occurredOn });
    if (bill) return { kind: "payment", billId: bill.id, pays: bill };
  }
  return { kind: "expense" };
}

/** The date an order confirmation arrived (local), or null for other kinds of email. */
// Subjects for mail sent the moment something was bought or paid, so its arrival date is the transaction date.
const PLACED_SUBJECT = /order (?:confirmed|confirmation|placed|receipt)|purchase confirmation|^\W*ordered\b|thank(?:s| you) for your (?:order|purchase)|your .{0,30}receipt|receipt from|payment confirmation/i;

export function orderPlacedOn(email: { subject: string; date: string }) {
  if (!PLACED_SUBJECT.test(email.subject)) return null;
  const received = new Date(email.date);
  return Number.isNaN(received.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(received);
}

export function resolveBulkCandidate(extracted: ExtractedTransaction, email: BulkEmail): BulkCandidate | { reason: string } {
  const facts = extractInvoiceFacts(email);
  const factAmount = facts.amount ? Math.round(Number.parseFloat(facts.amount.replace(/[$,]/g, "")) * 100) : null;
  // The amount must be one the email itself shows as money. A model that took the year for the total is caught here, and the total the plain rules found is used.
  const amountMinor = groundAmount(extracted.amountMinor, `${email.subject} ${email.snippet} ${email.text}`, factAmount);
  const confirmation = PLACED_SUBJECT.test(email.subject) || /receipt|invoice/i.test(email.subject);
  if (!extracted.isTransaction && !confirmation) return { reason: "not a purchase record" };
  if (!amountMinor) return { reason: `no total found: ${describeMissingTotal(email)}` };
  const merchant = extracted.merchant || email.from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  if (!merchant) return { reason: "no merchant found" };
  const received = new Date(email.date);
  const emailDate = Number.isNaN(received.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(received);
  // An order confirmation's own date is when it was placed. Dates in the body are often estimated ship or delivery dates.
  const occurredOn = PLACED_SUBJECT.test(email.subject) && emailDate ? emailDate : extracted.occurredOn || emailDate;
  if (!occurredOn) return { reason: "no date found" };
  return {
    candidate: isCardPayment(email)
      ? { occurredOn, amountMinor, currency: extracted.currency ?? "USD", direction: "transfer" as const, merchant, category: "other", note: "Credit card payment" }
      : { occurredOn, amountMinor, currency: extracted.currency ?? "USD", direction: extracted.direction ?? "expense", merchant, category: extracted.category ?? "other", note: extracted.note },
    usedEmailDate: occurredOn === emailDate && (!extracted.occurredOn || occurredOn !== extracted.occurredOn),
  };
}


/** "import all iherb receipts": one review card for several orders, each dedupe-checked again on Confirm. */
/** The Gmail search for a bulk import: purchase-style subjects, from one sender when named, within the window. */
export function bulkImportQuery(sender: string | null, days: number | null) {
  return [sender ? `{from:"${sender}" "${sender}"}` : "", `{subject:confirmed subject:confirmation subject:receipt subject:ereceipt subject:invoice subject:ordered subject:order subject:payment}`, days ? `newer_than:${days}d` : ""].filter(Boolean).join(" ");
}

async function prepareBulkEmailImport(input: string, userId: string, conversationId: string) {
  const parsed = parseEmailRequest(input);
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const applied = applyLearnings({ ...parsed, action: "import_all", topic: "receipt" }, learnings, { everything: mentionsAll(input) });
  const sender = applied.request.sender;
  // No named sender means a sweep: look for purchase emails from anyone in the window ("import my receipts from the last week"), for a person who
  // cannot remember where they spent. The same receipt checks, the batch cap and the approval step apply.
  const scope = sender ?? "purchase";
  const days = applied.request.days;
  const terms = describeSearch(applied.request, applied.defaultedWindow);
  // R5.7: keep the default window unset in state so it can be re-applied, or replaced by a follow-up like "last 90 days".
  await saveEmailState(userId, conversationId, { request: { ...applied.request, days: applied.defaultedWindow ? null : days }, results: [] });
  try {
    // Target confirmation-style subjects and look wider than the default 20 hits, so promo and shipping mail can't crowd out older orders.
    const safe = sender?.replaceAll('"', "") ?? "";
    const found = await searchGmail(userId, bulkImportQuery(sender ? safe : null, days), sender ? 50 : 80);
    const eligible = deduplicateOrders(found
      .filter((message) => !sender || senderMatches(message.from, sender))
      .filter((message) => (emailIntentRelevance(message, "receipt") >= minimumEmailRelevance("receipt") || isCardPayment(message)) && documentScore(message, input) >= minimumDocumentScore(input))
      .sort((left, right) => confirmationRank(right) - confirmationRank(left) || right.receivedAt - left.receivedAt));
    if (!eligible.length) {
      return `No ${scope} receipts to import${days ? ` in the last ${days} days${applied.defaultedWindow ? " (that's my default window)" : ""}` : ""}. Nothing was imported.\n\nWant me to look further back? Try “last 90 days”, or “always search 90 days” and I’ll remember.\n\n_Searched: ${terms}._`;
    }
    const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
    const batch = eligible.slice(0, BULK_LIMIT);
    const attemptOne = async (message: (typeof batch)[number]): Promise<BulkOutcome> => {
      const email = await readGmailMessage(userId, message.id);
      if (!isLikelyRequestedDocument(email, input)) return { kind: "skipped", subject: email.subject, reason: "not a purchase record" };
      const evidence = buildEvidence(email);
      const resolved = resolveBulkCandidate(await extractForEmail(userId, email, evidence, today), email);
      if ("reason" in resolved) return { kind: "skipped", subject: email.subject, reason: resolved.reason };
      return {
        kind: "item",
        candidate: applyMerchantLearnings(resolved.candidate, learnings).candidate,
        source: { type: "email" as const, externalRef: email.id, payload: JSON.stringify({ subject: email.subject, from: email.from, date: email.date }) },
        subject: email.subject,
        usedEmailDate: resolved.usedEmailDate,
        documentKind: classifyDocument(email.subject),
        dueOn: extractDueDate(email.text, resolved.candidate.occurredOn),
        importKind: "expense" as const,
      };
    };
    const settled = await Promise.allSettled(batch.map(attemptOne));
    // A failure is usually transient (the request's time or cost limit, a slow model call), so each failed email gets one more try, one at a time.
    const retried: PromiseSettledResult<BulkOutcome>[] = [];
    for (const [index, result] of settled.entries()) {
      retried.push(result.status === "fulfilled" ? result : (await Promise.allSettled([attemptOne(batch[index])]))[0]);
    }
    const items = retried.flatMap((result) => result.status === "fulfilled" && result.value.kind === "item" ? [result.value] : []);
    const skipped = retried.flatMap((result, index) => result.status === "fulfilled" && result.value.kind === "skipped"
      ? [{ subject: result.value.subject, reason: result.value.reason }]
      : result.status === "rejected" ? [{ subject: batch[index].subject, reason: `couldn’t be read (${describeFailure(result.reason)})` }] : []);
    const escape = (value: string) => value.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");
    const skippedNote = skipped.length ? `\n\nSkipped ${skipped.length}:\n${skipped.map((item) => `- ${escape(item.subject)} — ${item.reason}`).join("\n")}` : "";
    // R17: bills stay bills, and a payment settles the matching outstanding bill (each bill at most once).
    const pool = await listBills(userId, "outstanding").catch(() => [] as Bill[]);
    for (const item of items) {
      const decided = decideImportKind(item.documentKind, { text: "" }, item.candidate, pool);
      item.importKind = decided.kind;
      item.dueOn = decided.kind === "bill" ? item.dueOn : null;
      if (decided.kind === "payment" && decided.pays) { item.billId = decided.billId; item.pays = decided.pays; pool.splice(pool.findIndex((bill) => bill.id === decided.billId), 1); }
    }
    // One store, one category: the most common across this batch, so a model wobble on one order cannot split them.
    const votes = new Map<string, Map<string, number>>();
    for (const item of items) {
      const merchant = item.candidate.merchant.toLowerCase();
      const counts = votes.get(merchant) ?? new Map<string, number>();
      counts.set(item.candidate.category, (counts.get(item.candidate.category) ?? 0) + 1);
      votes.set(merchant, counts);
    }
    for (const item of items) {
      const counts = votes.get(item.candidate.merchant.toLowerCase())!;
      item.candidate.category = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
    }
    // What is already recorded is left out of the preview and the total, so the card says what confirming will really add. Bills have their own check.
    const recorded: typeof items = [];
    for (const item of [...items]) {
      if (item.importKind === "bill") continue;
      const hit = await previewDuplicate(userId, item.candidate, item.source).catch(() => null);
      if (hit) { recorded.push(item); items.splice(items.indexOf(item), 1); }
    }
    const recordedNote = recorded.length ? `Already recorded, so left out (${recorded.length}): ${recorded.map((item) => `${escape(item.candidate.merchant)} ${formatMoney(item.candidate.amountMinor, item.candidate.currency)} on ${item.candidate.occurredOn}`).join("; ")}.` : "";
    if (!items.length && recorded.length) return `All ${recorded.length} of these ${recorded.length === 1 ? "is" : "are"} already recorded, so there is nothing to import.\n\n${recordedNote}${skippedNote}`;
    if (!items.length) return `I found ${scope} email, but none could be imported. Nothing was imported.${skippedNote}`;
    await createFinanceImportApproval(userId, conversationId, { items: items.map(({ candidate, source, importKind, billId, dueOn }) => ({ candidate, source, ...(importKind === "expense" ? {} : { kind: importKind, billId, dueOn }) })) });
    // R13.1, R5.7: the card is a numbered list of orders, so "import only the second one" has something to point at.
    await saveEmailState(userId, conversationId, {
      request: { ...applied.request, days: applied.defaultedWindow ? null : days },
      results: items.map((item) => {
        const meta = JSON.parse(item.source.payload) as { subject: string; from: string; date: string };
        return { id: item.source.externalRef, subject: meta.subject, from: meta.from, date: meta.date };
      }),
    });
    const total = items.reduce((sum, item) => sum + item.candidate.amountMinor, 0);
    const currencies = new Set(items.map((item) => item.candidate.currency));
    const label = (item: (typeof items)[number]) => item.importKind === "bill" ? ` · **bill**, not counted until paid${item.dueOn ? ` (due ${item.dueOn})` : ""}` : item.importKind === "payment" && item.pays ? ` · pays your ${item.pays.merchant} bill${item.candidate.direction === "transfer" ? ", not counted as spending" : ""}` : item.candidate.direction === "transfer" ? " · **card payment**, not counted as spending" : "";
    const rows = items.map((item, index) => `${index + 1}. **${item.candidate.merchant}** — ${formatMoney(item.candidate.amountMinor, item.candidate.currency)} · ${item.candidate.occurredOn}${item.usedEmailDate ? " (email date)" : ""} · ${item.candidate.category}${label(item)}  \n   ${escape(item.subject)}`);
    const dates = items.map((item) => item.candidate.occurredOn).sort();
    const searched = `_Searched: ${terms}${days ? "" : ", up to 50 recent matches"}. These orders span ${dates[0]} to ${dates.at(-1)}. Not what you meant? Say “last 90 days”, “I meant …”, or “always search 90 days”._`;
    const notes = [searched, recordedNote, eligible.length > BULK_LIMIT ? `Showing the ${BULK_LIMIT} most recent of ${eligible.length} orders; ask again after confirming to continue.` : ""].filter(Boolean);
    return `### Review ${items.length} imports\n\n${rows.join("\n")}\n\n${currencies.size === 1 ? `**Counts as spending: ${formatMoney(items.filter((item) => item.importKind !== "bill" && item.candidate.direction !== "transfer").reduce((sum, item) => sum + item.candidate.amountMinor, 0), [...currencies][0])}**${[items.some((item) => item.importKind === "bill") && "bills aren’t included until paid", items.some((item) => item.candidate.direction === "transfer") && "card payments aren’t spending"].filter(Boolean).length ? ` (${[items.some((item) => item.importKind === "bill") && "bills aren’t included until paid", items.some((item) => item.candidate.direction === "transfer") && "card payments aren’t spending"].filter(Boolean).join("; ")})` : ""}\n\n` : ""}${notes.join(" ")}${skippedNote}\n\nChoose **Confirm** to import all of them or **Cancel** to leave your finances unchanged. To take just one, say “import only the second one”. Anything already recorded is skipped, and this preview expires in 30 minutes.`;
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError) return "Gmail read access is not connected. Reconnect Google and approve read-only Gmail access.";
    if (error instanceof GoogleGmailAccessError) return "Gmail could not be read right now. Nothing was imported; please try again shortly.";
    throw error;
  }
}
