import { compileEmailSearch } from "./email-search-plan";
import { selectEmailResults } from "./email-result-selection";
import { reportFailure } from "@/lib/observability/report";
import { acquireEmailScan, saveEmailScan, ScanBusyError, ScanStoppedError, type ScanHandle } from "@/lib/workflows/email-scan";
import { newGmailImportCursor, type GmailImportCursor, type EmailSearchResult } from "@/lib/tools/email/google-gmail";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { isUpiEmail, remitlyTransfer, transferLabel } from "./email-import-rules";
import { gmailFailureMessage } from "@/lib/tools/email/gmail-transport";
import { Temporal } from "@js-temporal/polyfill";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { extractTransactionFromEvidence, type ExtractedTransaction } from "@/lib/model/claude";
import { buildEvidence, describeMissingTotal, extractInvoiceFacts } from "./email-invoice";
import { orderKey, confirmationRank, senderMatches } from "./email";
import { saveEmailState } from "@/lib/conversations/email-state";
import { NO_LEARNINGS, applyLearnings, describeSearch } from "@/lib/learning/learnings";
import { createInterpretationCache } from "./email-interpreter-runtime";
import { applyMerchantLearnings, guessCategory } from "@/lib/learning/preferences";
import { listBills } from "@/lib/tools/finance/bills";
import { groundAmount } from "./amount-grounding";
import { previewDuplicate, recordedEmailRefs } from "@/lib/tools/finance/transactions";
import { IMPORT_BUDGET } from "@/lib/runtime/import-budget";
import { extendRequestBudget, remainingRequestMs, getRequestContext } from "@/lib/runtime/request-context";
import { pickSpendingEmailsForUser } from "./spending-picker-runtime";
import { classifyDocument, extractDueDate, matchPayment, type Bill, type DocumentKind } from "./bills";
import { loadLearnings } from "@/lib/learning/store";
import { mentionsAll, parseEmailRequest, type EmailRequest } from "./email-request";
import { STRONG_RECEIPT_SUBJECT, emailIntentRelevance, minimumEmailRelevance } from "./email-relevance";
import { GoogleGmailAccessError, readGmailAttachment, readGmailMessage, searchGmail, searchGmailForImport } from "@/lib/tools/email/google-gmail";
import { createFinanceImportApproval } from "@/lib/workflows/finance-import";
import { extractBillStatement, resolveBillStatement, type BillStatement } from "./bill-statement";
import { sameMerchant } from "./bills";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

/** Dues includes statement balances; ordinary spending imports intentionally exclude unpaid statements. */
export async function prepareEmailDuesImport(userId: string, conversationId: string, days = 90) {
  return prepareBulkEmailImport(`Import all bills in the last ${days} days`, userId, conversationId, "bills");
}

export async function prepareEmailFinanceImport(input: string, userId: string, conversationId?: string, request?: EmailRequest) {
  if (!conversationId) return "I can’t create a durable approval without a saved conversation. Please start a new chat and try again.";
  if (request ? request.action === "import_all" : /\b(?:all|every|each)\b/i.test(input)) return prepareBulkEmailImport(input, userId, conversationId, "spending", undefined, request);
  await saveEmailState(userId, conversationId, { request: request ?? parseEmailRequest(input), results: [] });
  try {
    const messages = await searchGmail(userId, request ? compileEmailSearch(request) : buildImportQuery(input));
    if (!messages.length) return "I couldn’t find a matching receipt, invoice, order, or bill in Gmail.";
    const ranked = request ? await selectEmailResults(userId, request, messages) : rankImportMessages(messages, input);
    const selected = ranked[0];
    if (!selected || (!request && documentScore(selected, input) < minimumDocumentScore(input))) {
      return `I found related email, but none looked like an actual payable statement or purchase receipt. Nothing was imported.${selected ? `\n\nClosest match: **${selected.subject.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1")}**` : ""}`;
    }
    return await previewImportFromMessage(userId, conversationId, selected.id, input, Boolean(request));
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError) return "Gmail read access is not connected. Reconnect Google and approve read-only Gmail access.";
    if (error instanceof GoogleGmailAccessError) return `Nothing was imported: ${gmailFailureMessage(error)}.`;
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
    if (error instanceof GoogleGmailAccessError) return `Nothing was imported: ${gmailFailureMessage(error)}.`;
    throw error;
  }
}

async function previewImportFromMessage(userId: string, conversationId: string, messageId: string, input: string, explicit: boolean) {
  const email = await readGmailMessage(userId, messageId);
  if (isUpiEmail(email)) return "UPI transactions are excluded from imports. Nothing was imported.";
  const remittance = remitlyTransfer(email);
  if (remittance && "reason" in remittance) return `Nothing was imported: ${remittance.reason}.`;
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
    direction: isCardPayment(email) ? "transfer" as const : isUtilityPayment(email) ? "expense" as const : extracted.direction ?? "expense" as const,
    merchant: extracted.merchant!,
    category: extracted.category ?? "other",
    note: extracted.note,
  }, learnings);
  const candidate = learned.candidate;
  if (isCardPayment(email)) candidate.note = "Credit card payment";
  if (remittance) Object.assign(candidate, { amountMinor: remittance.amountMinor, currency: remittance.currency, merchant: "Remitly", direction: "transfer", category: "other", note: `Remittance ${remittance.reference}` });
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
const CARD_ISSUER = /(?:^|[.@])(?:chase|capitalone|americanexpress|amex|discover|discovercard|citi|bankofamerica|wellsfargo|synchrony|barclays|usbank|applecard)\.[a-z]{2,}(?:[>\s]|$)/i;

/** Service bill payments are expenses, including when paid using a credit card. */
export function isUtilityPayment(email: { from: string; subject: string; text?: string; snippet?: string }) {
  const content = `${email.subject} ${email.snippet ?? ""} ${email.text ?? ""}`;
  const provider = /(?:^|[.@])(?:xfinity|comcast)\.(?:com|net)(?:[>\s]|$)/i.test(email.from.split("<").at(-1) ?? email.from);
  const service = /\b(?:utility|electricity|electric|gas|water|internet|broadband|mobile|wireless|sewer) (?:bill|service|payment|account)\b/i.test(content);
  return (provider || service) && /\b(?:payment|paid)\b/i.test(content) && !/\b(?:refund|reversed|failed|declined)\b/i.test(content);
}

/** A credit card issuer's payment notice: the payment on a card bill. It is recorded as a transfer, never as spending. */
export function isCardPayment(email: { from: string; subject: string; text?: string }) {
  const text = `${email.subject} ${email.text ?? ""}`;
  const explicit = /\b(?:payment (?:to|toward|towards|on|for) (?:your |the |my )?(?:credit )?card(?: balance| bill)?|(?:credit )?card (?:balance|bill) payment)\b/i.test(text);
  return explicit || (CARD_ISSUER.test(email.from.split("<").at(-1) ?? email.from) && classifyDocument(email.subject) === "payment");
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
  | { kind: "item"; candidate: BulkCandidate["candidate"]; source: { type: "email"; externalRef: string; payload: string }; subject: string; usedEmailDate: boolean; documentKind: DocumentKind; dueOn: string | null; importKind: ImportKind["kind"]; billId?: string; pays?: Bill; accountLastFour?: string | null }
  | { kind: "skipped"; subject: string; reason: string };

function describeFailure(reason: unknown) {
  const name = reason instanceof Error ? reason.name : "";
  if (name === "QueryBudgetUnavailableError") return "this request hit its model cost or time limit";
  if (name === "AbortError") return "it ran out of time";
  if (name === "GoogleGmailAccessError") return gmailFailureMessage(reason as GoogleGmailAccessError);
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
  // Payments need their actual payment date/payee; known non-USD currencies need model extraction.
  if (classifyDocument(email.subject) === "payment" || /\b(?:CAD|AUD|NZD|SGD|HKD|INR|EUR|GBP)\b|CA\$|AU\$|[€£₹]/i.test(`${email.snippet} ${email.text}`)) return null;
  const placedOn = orderPlacedOn(email);
  const amount = extractInvoiceFacts(email).amount;
  const merchant = senderDisplayName(email.from);
  if (!placedOn || !amount || !merchant) return null;
  const amountMinor = Math.round(Number.parseFloat(amount.replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  return { isTransaction: true, amountMinor, currency: "USD", direction: "expense", merchant, category: guessCategory(merchant) ?? "shopping", occurredOn: placedOn, note: null, missingFields: [] };
}

const extractionCache = createInterpretationCache();
const EXTRACTION_VERSION = "extract-v5";

/** Deterministic first; otherwise the model, cached per email so the same email is never read twice. */
async function extractForEmail(userId: string, email: Parameters<typeof deterministicOrderExtraction>[0] & { id: string }, evidence: string, today: string, attachment?: Parameters<typeof extractTransactionFromEvidence>[2]) {
  const direct = attachment ? null : deterministicOrderExtraction(email);
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
export function decideImportKind(documentKind: DocumentKind, email: { text: string }, candidate: { merchant: string; amountMinor: number; currency?: string; accountLastFour?: string | null; occurredOn: string }, outstanding: Bill[]): ImportKind {
  if (documentKind === "bill") return { kind: "bill", dueOn: extractDueDate(email.text, candidate.occurredOn) };
  if (documentKind === "payment") {
    const bill = matchPayment(outstanding, { merchant: candidate.merchant, amountMinor: candidate.amountMinor, currency: candidate.currency, accountLastFour: candidate.accountLastFour, date: candidate.occurredOn });
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

export function resolveBulkCandidate(extracted: ExtractedTransaction, email: BulkEmail, attachmentEvidence = false): BulkCandidate | { reason: string } {
  if (isUpiEmail(email)) return { reason: "UPI transactions are excluded from imports" };
  const remittance = remitlyTransfer(email);
  if (remittance && "reason" in remittance) return remittance;
  const facts = extractInvoiceFacts(email);
  const factAmount = facts.amount ? Math.round(Number.parseFloat(facts.amount.replace(/[$,]/g, "")) * 100) : null;
  // The amount must be one the email itself shows as money. A model that took the year for the total is caught here, and the total the plain rules found is used.
  const amountMinor = attachmentEvidence ? extracted.amountMinor : groundAmount(extracted.amountMinor, `${email.subject} ${email.snippet} ${email.text}`, factAmount);
  if (!extracted.isTransaction || extracted.direction === "income") return { reason: "not a purchase record" };
  if (!amountMinor || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { reason: `no total found: ${describeMissingTotal(email)}` };
  const merchant = extracted.merchant || email.from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  if (!merchant) return { reason: "no merchant found" };
  const received = new Date(email.date);
  const emailDate = Number.isNaN(received.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(received);
  // An order confirmation's own date is when it was placed. Dates in the body are often estimated ship or delivery dates.
  const occurredOn = classifyDocument(email.subject) !== "payment" && PLACED_SUBJECT.test(email.subject) && emailDate ? emailDate : extracted.occurredOn || emailDate;
  if (!occurredOn) return { reason: "no date found" };
  try { if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) throw new Error(); Temporal.PlainDate.from(occurredOn); }
  catch { return { reason: "invalid transaction date" }; }
  return {
    candidate: remittance
      ? { occurredOn, amountMinor: remittance.amountMinor, currency: remittance.currency, direction: "transfer" as const, merchant: "Remitly", category: "other", note: `Remittance ${remittance.reference}` }
      : isCardPayment(email)
      ? { occurredOn, amountMinor, currency: extracted.currency ?? "USD", direction: "transfer" as const, merchant, category: "other", note: "Credit card payment" }
      : { occurredOn, amountMinor, currency: extracted.currency ?? "USD", direction: isUtilityPayment(email) ? "expense" : extracted.direction ?? "expense", merchant, category: isUtilityPayment(email) ? "utilities" : extracted.category ?? "other", note: extracted.note },
    usedEmailDate: occurredOn === emailDate && (!extracted.occurredOn || occurredOn !== extracted.occurredOn),
  };
}


/** "import all iherb receipts": one review card for several orders, each dedupe-checked again on Confirm. */
/**
 * The Gmail search for a bulk import: everything in the window, from one sender when named. Which of these mails record spending is decided by a
 * model (spending-picker), not by subject words, so no store's wording can be missed by the search itself.
 */
export function bulkImportQuery(sender: string | null, days: number | null) {
  return [sender ? `{from:"${sender.replaceAll('"', "")}" "${sender.replaceAll('"', "")}"}` : "", "-in:sent -in:chats -in:drafts -in:spam -in:trash -subject:UPI", days ? `newer_than:${days}d` : ""].filter(Boolean).join(" ");
}
const SWEEP_MAIL_LIMIT = 500; // bounded work per turn; the saved cursor has no 2,000-email cutoff
/** A sweep is the one request that legitimately takes longer and costs more, and it stops itself safely before the limit. */
const SWEEP_TOTAL_MS = IMPORT_BUDGET.totalMs;
const SWEEP_STOP_READING_AFTER_MS = IMPORT_BUDGET.readMs;
const SWEEP_COST_LIMIT_USD = IMPORT_BUDGET.costLimitUsd;
const READ_CHUNK = 6;

/** Order numbers are only unique within a merchant, not across an entire mailbox. */
export function deduplicateSpendingOrders<T extends { subject: string; snippet: string; from: string }>(messages: T[]) {
  const seen = new Set<string>();
  return [...messages].sort((a, b) => confirmationRank(b) - confirmationRank(a)).filter((message) => {
    const order = orderKey(message);
    const merchant = senderDisplayName(message.from).toLowerCase();
    if (!order || !merchant || classifyDocument(message.subject) === "payment") return true;
    const domain = message.from.match(/@([\w.-]+)/)?.[1]?.toLowerCase() ?? "";
    const key = `${merchant}:${domain}:${order}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type SavedImportScan = {
  input: string;
  mode: "spending" | "bills";
  applied: ReturnType<typeof applyLearnings>;
  today: string;
  cursor: GmailImportCursor;
  candidates: EmailSearchResult[];
  outcomes: Record<string, BulkOutcome>;
  failures?: Record<string, number>;
};

function scanHasMore(scan: SavedImportScan) {
  return scan.cursor.stage < scan.cursor.queries.length || scan.cursor.ready.length > 0 || scan.candidates.length > 0;
}

function publishScan(scan: SavedImportScan, canContinue = false) {
  const context = getRequestContext();
  if (!context) return;
  const found = Object.values(scan.outcomes).filter(outcome => outcome.kind === "item").length;
  const checked = scan.cursor.checked;
  context.scanProgress = {
    conversationId: context.conversationId, checked, found, retryAt: scan.cursor.retryAt, canContinue,
    checkpoint: `${checked}:${scan.cursor.stage}:${scan.cursor.ready.length}:${scan.candidates.length}:${Object.keys(scan.outcomes).length}`,
    label: `${checked} emails checked · ${found} records found. ${scan.cursor.retryAt > Date.now() ? "Waiting for Gmail; I’ll resume automatically." : "Checking " + (scan.cursor.stage < 2 ? "Primary and Updates" : "remaining email categories") + "…"}`,
  };
}

function scanProgress(scan: SavedImportScan) {
  const more = scanHasMore(scan);
  const wait = Math.max(0, Math.ceil((scan.cursor.retryAt - Date.now()) / 1000));
  const phase = scan.cursor.stage < 2 ? "Primary and Updates" : "other categories";
  return `${scan.cursor.checked} email summaries checked. ${scan.cursor.unavailable ? `${scan.cursor.unavailable} messages are no longer available. ` : ""}${more ? `**Scan paused** in ${phase}. Progress is saved for 7 days. ${scan.cursor.pending.length + scan.cursor.ready.length + scan.candidates.length} known emails remain${scan.cursor.stage < scan.cursor.queries.length ? "; more pages may follow" : ""}.${wait ? ` Gmail requested a cooldown; continue in ${wait} seconds.` : ""} Choose **Continue scan** to resume where this scan stopped. Continuing does not import anything.` : "Scan complete across all categories."}`;
}

export async function continueEmailFinanceImport(userId: string, conversationId?: string) {
  if (!conversationId) return "Open the conversation containing the scan to continue it.";
  prepareAgentStage(["email", "finance"], "balanced");
  extendRequestBudget(SWEEP_TOTAL_MS, SWEEP_COST_LIMIT_USD);
  try {
    const handle = await acquireEmailScan<SavedImportScan>(userId, conversationId);
    if (!handle) return "No saved scan is available in this conversation. Start a new import; scan progress is kept for 7 days.";
    if (handle.data.cursor.retryAt > Date.now()) {
      await saveEmailScan(handle, "paused");
      publishScan(handle.data, true);
      return `${scanProgress(handle.data)} Your previous review list is preserved.`;
    }
    return prepareBulkEmailImport(handle.data.input, userId, conversationId, handle.data.mode, handle);
  } catch (error) {
    if (error instanceof ScanBusyError) return "This scan is already running in another request. Wait for it to finish before continuing.";
    throw error;
  }
}

async function prepareBulkEmailImport(input: string, userId: string, conversationId: string, mode: "spending" | "bills" = "spending", resumed?: ScanHandle<SavedImportScan>, interpreted?: EmailRequest) {
  const startedAt = Date.now();
  extendRequestBudget(SWEEP_TOTAL_MS, SWEEP_COST_LIMIT_USD);
  const stopReadingAt = Math.min(startedAt + SWEEP_STOP_READING_AFTER_MS, startedAt + remainingRequestMs(SWEEP_TOTAL_MS) - IMPORT_BUDGET.finishReserveMs);
  const parsed = interpreted ?? resumed?.data.applied.request ?? parseEmailRequest(input);
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const applied = resumed?.data.applied ?? applyLearnings({ ...parsed, action: "import_all", topic: "receipt" }, learnings, { everything: mentionsAll(input) });
  const sender = applied.request.sender;
  // No named sender means a sweep: look for purchase emails from anyone in the window ("import my receipts from the last week"), for a person who
  // cannot remember where they spent. Evidence checks and the approval step still apply.
  const scope = sender ?? (mode === "bills" ? "bill or statement" : "purchase");
  const days = applied.request.days;
  const terms = describeSearch(applied.request, applied.defaultedWindow).replace(/^receipts/, mode === "bills" ? "bills and statements" : "receipts");
  // R5.7: keep the default window unset in state so it can be re-applied, or replaced by a follow-up like "last 90 days".
  await saveEmailState(userId, conversationId, { request: { ...applied.request, days: applied.defaultedWindow ? null : days }, results: [] });
  let handle = resumed;
  let stage = "checkpoint";
  let blocked = false;
  try {
    if (!handle) {
      const frozenQuery = bulkImportQuery(sender, days ?? 90).replace(/newer_than:\d+d/, `after:${Math.floor(startedAt / 1000) - (days ?? 90) * 86400} before:${Math.floor(startedAt / 1000) + 1}`);
      handle = (await acquireEmailScan(userId, conversationId, { input, mode, applied, today: Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString(), cursor: newGmailImportCursor(frozenQuery), candidates: [], outcomes: {} } satisfies SavedImportScan))!;
    }
    const saved = handle.data;
    const persist = async () => { const previous = stage; stage = "checkpoint"; await saveEmailScan(handle!); stage = previous; publishScan(saved); };
    publishScan(saved);
    // Search the entire date window, including archived mail and every Gmail category.
    const safe = sender?.replaceAll('"', "") ?? "";
    stage = "gmail_search";
    const scan = saved.candidates.length || saved.cursor.ready.length ? { messages: saved.cursor.ready } : await searchGmailForImport(userId, bulkImportQuery(sender ? safe : null, days ?? 90), SWEEP_MAIL_LIMIT, Math.min(startedAt + IMPORT_BUDGET.searchMs, stopReadingAt - IMPORT_BUDGET.finishReserveMs), { prioritizePayments: mode === "spending", cursor: saved.cursor, onProgress: persist });
    const found = scan.messages;
    // Mail already recorded is dropped first (one lookup), so a follow-up run moves on to what is left instead of re-reading the same emails.
    const recordedRefs = await recordedEmailRefs(userId, found.map((message) => message.id)).catch(() => new Set<string>());
    const fresh = found.filter((message) => !isUpiEmail(message) && !recordedRefs.has(message.id) && (!sender || senderMatches(message.from, sender)));
    stage = "selection";
    const pick = await pickSpendingEmailsForUser(userId, fresh.map((message) => ({ id: message.id, from: message.from, subject: message.subject, snippet: message.snippet, date: message.date })), mode);
    if (pick.unavailable) return `The model could not finish identifying financial records. Nothing was imported. ${scanProgress(saved)}`;
    const chosen = new Set([...pick.ids, ...(mode === "spending" ? fresh.filter(isCardPayment).map((message) => message.id) : [])]);
    const queued = new Map(saved.candidates.map(message => [message.id, message]));
    for (const message of fresh) if (chosen.has(message.id) && !saved.outcomes[message.id]) queued.set(message.id, message);
    saved.candidates = deduplicateSpendingOrders([...queued.values()]);
    saved.cursor.ready = [];
    await persist();
    stage = "extraction";
    const eligible = saved.candidates;
    const today = saved.today;
    const fromDate = days ? Temporal.PlainDate.from(today).subtract({ days }).toString() : null;
      const knownBills = mode === "bills" ? await listBills(userId) : [];
    const attemptOne = async (message: (typeof eligible)[number]): Promise<BulkOutcome> => {
      const email = await readGmailMessage(userId, message.id);
      if (isUpiEmail(email)) return { kind: "skipped", subject: email.subject, reason: "UPI transactions are excluded from imports" };
      const evidence = buildEvidence(email);
      let statement: BillStatement | undefined;
      if (mode === "bills") statement = await extractBillStatement(userId, email.id, evidence);
      let resolved = statement ? resolveBillStatement(statement, `${email.subject} ${email.snippet} ${email.text}`) : resolveBulkCandidate(await extractForEmail(userId, email, evidence, today), email);
      // Read an attachment only when the body could not supply a usable record.
      if ("reason" in resolved) {
        const metadata = email.attachments.find((item) => isSupportedAttachment(item.mimeType) && item.size <= 5_000_000);
        if (metadata) {
          const attachment = await readGmailAttachment(userId, email.id, metadata.id);
          const document = {
            data: Buffer.from(attachment.data, "base64url").toString("base64"),
            mediaType: metadata.mimeType as "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
          };
          if (mode === "bills") {
            statement = await extractBillStatement(userId, email.id, evidence, document);
            resolved = resolveBillStatement(statement, "", true);
          } else resolved = resolveBulkCandidate(await extractForEmail(userId, email, evidence, today, document), email, true);
        }
      }
      if ("reason" in resolved) return { kind: "skipped", subject: email.subject, reason: resolved.reason };
      if (resolved.candidate.occurredOn > today || (mode === "spending" && fromDate && resolved.candidate.occurredOn < fromDate)) {
        return { kind: "skipped", subject: email.subject, reason: `transaction date ${resolved.candidate.occurredOn} is outside the requested window` };
      }
      return {
        kind: "item",
        candidate: applyMerchantLearnings(resolved.candidate, learnings).candidate,
        source: { type: "email" as const, externalRef: email.id, payload: JSON.stringify({ subject: email.subject, from: email.from, date: email.date }) },
        subject: email.subject,
        usedEmailDate: resolved.usedEmailDate,
        documentKind: mode === "bills" ? "bill" : classifyDocument(email.subject),
        dueOn: statement ? statement.dueOn : extractDueDate(email.text, resolved.candidate.occurredOn),
        importKind: "expense" as const,
        accountLastFour: statement?.accountLastFour,
      };
    };
    // Save each finished group before starting more reads. Failures remain queued for Continue.
    for (let offset = 0; offset < eligible.length && Date.now() < stopReadingAt && Date.now() >= saved.cursor.retryAt; offset += READ_CHUNK) {
      const group = eligible.slice(offset, offset + READ_CHUNK);
      const results = await Promise.allSettled(group.map(attemptOne));
      let paused = false;
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          saved.outcomes[group[index].id] = result.value;
          saved.candidates = saved.candidates.filter(message => message.id !== group[index].id);
        } else {
          const error = result.reason;
          const systemic = ["ModelBudgetExceededError", "GoogleConnectionRequiredError", "QueryBudgetUnavailableError"].includes(error?.name) || ["rate_limited", "unavailable", "insufficient_scope", "forbidden", "api_disabled", "quota_exceeded"].includes(error?.reason);
          if (systemic) paused = true;
          if (!systemic && error?.reason !== "not_found") {
            saved.failures ??= {};
            const id = group[index].id;
            saved.failures[id] = (saved.failures[id] ?? 0) + 1;
            if (saved.failures[id] >= 3) {
              saved.outcomes[id] = { kind: "skipped", subject: group[index].subject, reason: "couldn’t be read after three attempts; excluded from this review" };
              saved.candidates = saved.candidates.filter(message => message.id !== id);
            }

          }
          if (["ModelBudgetExceededError", "GoogleConnectionRequiredError"].includes(error?.name) || (error?.name === "QueryBudgetUnavailableError" && error.reason === "cost")) blocked = true;
          if (error?.reason === "not_found") {
            saved.outcomes[group[index].id] = { kind: "skipped", subject: group[index].subject, reason: "message no longer available" };
            saved.candidates = saved.candidates.filter(message => message.id !== group[index].id);
          } else if (error?.reason === "rate_limited") saved.cursor.retryAt = Math.max(saved.cursor.retryAt, Date.now() + (error.retryAfterMs ?? 30_000));
        }
      }
      await persist();
      if (paused) break;
    }
    if (scanHasMore(saved) && !blocked && getRequestContext()?.automaticScan) {
      publishScan(saved, true);
      return `I’m checking your emails and collecting records for one review. ${scanProgress(saved)}`;
    }
    const incomplete = scanHasMore(saved) ? scanProgress(saved) : "";
    stage = "review";
    // Upgrade unconfirmed saved outcomes as well as newly extracted records.
    for (const outcome of Object.values(saved.outcomes)) {
      if (mode !== "spending" || outcome.kind !== "item") continue;
      try {
        const meta = JSON.parse(outcome.source.payload);
        if (!isCardPayment(meta) && isUtilityPayment(meta)) Object.assign(outcome.candidate, { direction: "expense", category: "utilities" });
      } catch { /* Older sources may lack metadata. */ }
    }
    const allOutcomes = Object.values(saved.outcomes);
    const items = allOutcomes.flatMap(outcome => outcome.kind === "item" ? [structuredClone(outcome)] : []);
    const remittanceRefs = new Set<string>();
    for (const item of [...items]) {
      const ref = item.candidate.note?.match(/^Remittance ([A-Z0-9-]+)$/)?.[1];
      if (!ref) continue;
      if (remittanceRefs.has(ref)) items.splice(items.indexOf(item), 1);
      else remittanceRefs.add(ref);
    }
    // Card balances roll forward. With a known account, show only its latest statement in this scan.
    if (mode === "bills") {
      const seen = new Set<string>();
      items.sort((a, b) => b.candidate.occurredOn.localeCompare(a.candidate.occurredOn));
      for (const item of [...items]) {
        const key = item.candidate.direction === "transfer" && item.accountLastFour
          ? `${item.candidate.merchant.toLowerCase()}:${item.candidate.currency}:${item.accountLastFour}`
          : `${item.candidate.merchant.toLowerCase()}:${item.candidate.currency}:${item.accountLastFour ?? ""}:${item.candidate.occurredOn}:${item.candidate.amountMinor}`;
        if (seen.has(key)) items.splice(items.indexOf(item), 1); else seen.add(key);
      }
    }
    const skipped = allOutcomes.flatMap(outcome => outcome.kind === "skipped" ? [{ subject: outcome.subject, reason: outcome.reason }] : []);
    // Do this after choosing the newest card statement, so a saved/paid latest statement cannot reveal an older balance as a new due.
    if (mode === "bills") for (const item of [...items]) {
      if (knownBills.some((bill) => bill.currency === item.candidate.currency && bill.amountMinor === item.candidate.amountMinor && bill.statementDate === item.candidate.occurredOn && sameMerchant(bill.merchant, item.candidate.merchant) && (bill.accountLastFour ?? null) === (item.accountLastFour ?? null))) {
        items.splice(items.indexOf(item), 1);
        skipped.push({ subject: item.subject, reason: "this statement is already recorded, including its payment status" });
      }
    }
    const escape = (value: string) => value.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");
    const skippedNote = skipped.length ? `\n\nSkipped ${skipped.length}:\n${skipped.map((item) => `- ${escape(item.subject)} — ${item.reason}`).join("\n")}` : "";
    // R17: bills stay bills, and a payment settles the matching outstanding bill (each bill at most once).
    const pool = await listBills(userId, "outstanding").catch(() => [] as Bill[]);
    for (const item of items) {
      const decided = decideImportKind(item.documentKind, { text: "" }, { ...item.candidate, accountLastFour: item.accountLastFour }, pool);
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
    for (let offset = 0; offset < items.length;) {
      const group = items.slice(offset, offset + READ_CHUNK);
      const hits = await Promise.all(group.map((item) => item.importKind === "bill" ? null : previewDuplicate(userId, item.candidate, item.source).catch(() => null)));
      for (const [index, item] of group.entries()) {
        if (hits[index]) { recorded.push(item); items.splice(items.indexOf(item), 1); }
        else offset += 1;
      }
    }
    const recordedNote = recorded.length ? `Already recorded, so left out (${recorded.length}): ${recorded.map((item) => `${escape(item.candidate.merchant)} ${formatMoney(item.candidate.amountMinor, item.candidate.currency)} on ${item.candidate.occurredOn}`).join("; ")}.` : "";
    if (!items.length && recorded.length) return `These ${recorded.length} items are already recorded.\n\n${recordedNote}${skippedNote}${incomplete ? `\n\nScan incomplete: ${incomplete}` : ""}`;
    if (!items.length) return `No records are ready for review${incomplete ? " yet" : ""}. Nothing was imported.${skippedNote}\n\n${incomplete || scanProgress(saved)}`;
    await createFinanceImportApproval(userId, conversationId, { items: items.map(({ candidate, source, importKind, billId, dueOn, accountLastFour }) => ({ candidate, source, accountLastFour, ...(importKind === "expense" ? {} : { kind: importKind, billId, dueOn }) })) });
    // R13.1, R5.7: the card is a numbered list of orders, so "import only the second one" has something to point at.
    await saveEmailState(userId, conversationId, {
      request: { ...applied.request, days: applied.defaultedWindow ? null : days },
      results: items.map((item) => {
        const meta = JSON.parse(item.source.payload) as { subject: string; from: string; date: string };
        return { id: item.source.externalRef, subject: meta.subject, from: meta.from, date: meta.date };
      }),
    });
    const currencies = new Set(items.map((item) => item.candidate.currency));
    const label = (item: (typeof items)[number]) => item.importKind === "bill" ? ` · **${item.candidate.direction === "transfer" ? "credit-card statement" : "bill"}**${item.dueOn ? ` · due ${item.dueOn}` : " · due date not stated"}` : item.importKind === "payment" && item.pays ? ` · pays your ${item.pays.merchant} bill${item.candidate.direction === "transfer" ? ", not counted as spending" : ""}` : item.candidate.direction === "transfer" ? ` · **${transferLabel(item.candidate)}**, not counted as spending` : "";
    const rows = items.map((item, index) => `${index + 1}. **${item.candidate.merchant}**${item.accountLastFour ? ` (account ending ${item.accountLastFour})` : ""} — ${formatMoney(item.candidate.amountMinor, item.candidate.currency)} · ${item.candidate.occurredOn}${item.usedEmailDate ? " (email date)" : ""} · ${item.candidate.category}${label(item)}  \n   ${escape(item.subject)}`);
    const dates = items.map((item) => item.candidate.occurredOn).sort();
    const searched = `_Searched: ${terms}. These records span ${dates[0]} to ${dates.at(-1)}. Not what you meant? Say “last 90 days”, “I meant …”, or “always search 90 days”._`;
    const notes = [searched, "UPI transactions are excluded.", recordedNote, incomplete ? `**Scan incomplete:** ${incomplete}` : scanProgress(saved), skipped.length ? `Some candidate emails were skipped; this preview may not include all ${mode === "bills" ? "dues" : "spending"}.` : ""].filter(Boolean);
    if (mode === "bills") return `### Statements found in email\n\n${rows.join("\n")}\n\nThese are statement balances, not verified live balances; a statement may have been paid since it arrived. Review them before saving.\n\n${notes.join(" ")}${skippedNote}\n\nChoose **Confirm** to save these bills and show them in **Perch → Reminders → All dues**, or **Cancel**. They won’t be added to spending. This preview expires in 30 minutes.`;
    return `### Review ${items.length} imports\n\n${rows.join("\n")}\n\n${currencies.size === 1 ? `**Counts as spending: ${formatMoney(items.filter((item) => item.importKind !== "bill" && item.candidate.direction !== "transfer").reduce((sum, item) => sum + item.candidate.amountMinor, 0), [...currencies][0])}**${[items.some((item) => item.importKind === "bill") && "bills aren’t included until paid", items.some((item) => item.candidate.direction === "transfer") && "transfers aren’t spending"].filter(Boolean).length ? ` (${[items.some((item) => item.importKind === "bill") && "bills aren’t included until paid", items.some((item) => item.candidate.direction === "transfer") && "transfers aren’t spending"].filter(Boolean).join("; ")})` : ""}\n\n` : ""}${notes.join(" ")}${skippedNote}\n\nChoose **Confirm** to import all of them or **Cancel** to leave your finances unchanged. To take just one, say “import only the second one”. Anything already recorded is skipped, and this preview expires in 30 minutes.`;
  } catch (error) {
    if (error instanceof ScanStoppedError && handle) { publishScan(handle.data, false); return "Scan paused and progress saved. Choose **Continue scan** when you’re ready. Nothing was imported."; }
    if (error instanceof GoogleConnectionRequiredError) return `Gmail read access is not connected. Reconnect Google and approve read-only Gmail access.${handle ? ` ${scanProgress(handle.data)}` : ""}`;
    if (error instanceof GoogleGmailAccessError) return `Nothing was imported: ${gmailFailureMessage(error)}.${handle ? ` ${scanProgress(handle.data)}` : ""}`;
    if (error instanceof ScanBusyError) return "This scan is already running. Wait for that request to finish before continuing.";
    if (handle) {
      reportFailure("email_scan_paused", error, { operation: "email_finance_scan", stage });
      publishScan(handle.data, !["ModelBudgetExceededError", "QueryBudgetUnavailableError"].includes((error as Error)?.name));
      return `Your scan progress is saved. ${scanProgress(handle.data)}`;
    }
    throw error;
  } finally {
    if (handle) {
      try { await saveEmailScan(handle, scanHasMore(handle.data) ? "paused" : "completed"); }
      catch (error) {
        if (!(error instanceof ScanStoppedError)) throw error;
        publishScan(handle.data, false);
        return "Scan paused and progress saved. Choose **Continue scan** when you’re ready. Nothing was imported.";
      }
    }
  }
}
