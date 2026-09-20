import { RECEIPT_WORDS, fixDomainTypos, stripExclusions } from "./email-query";

export function recruiterRelevance(message: { subject: string; from: string; snippet: string }) {
  const subject = message.subject.toLowerCase();
  const from = message.from.toLowerCase();
  const snippet = message.snippet.toLowerCase();
  let score = 0;
  if (/\b(recruiter|recruiting|talent acquisition|staffing|sourcer)\b/.test(`${subject} ${from}`)) score += 3;
  if (/\b(interview|application|candidate|hiring manager|job opening|job opportunity|career opportunity|role at|position at)\b/.test(subject)) score += 2;
  if (/\b(interview|application|candidate|hiring manager|job opening|job opportunity|career opportunity|your resume|your profile|position)\b/.test(snippet)) score += 1;
  if (/newsletter|digest|sale|discount|webinar|community update|roundup|round up/.test(`${subject} ${snippet}`)) score -= 3;
  return score;
}

export type EmailIntent = "recruiter" | "promotion" | "receipt" | "general";

export function detectEmailIntent(rawInput: string): EmailIntent {
  const { core } = stripExclusions(fixDomainTypos(rawInput));
  if (/\b(recruiter|recruiters|recruiting|job opportunity|hiring)\b/i.test(core)) return "recruiter";
  // A receipt noun wins over "promotion": "was it an order confirmation or just a promotion?" is a receipt question.
  if (RECEIPT_WORDS.test(core)) return "receipt";
  if (/\b(promotion|promotions|promotional|offers?|deals?|discounts?|coupons?|sales?)\b/i.test(core)) return "promotion";
  return "general";
}

/** Subjects that name a receipt-type document outright. Deliberately not "order", "ticket" or "confirmed" alone. */
export const STRONG_RECEIPT_SUBJECT = /\b(?:(?:order|purchase|payment|booking) (?:receipt|confirmation)|receipt|invoice|payment (?:received|successful)|(?:we['’]ve|we have) received your payment|thank(?:s| you) for your (?:order|purchase|payment)|(?:your|new|latest|monthly)(?: \w+)? statement|statement (?:is )?(?:ready|available|here|now available)|(?:your |new )?bill (?:is )?(?:ready|available|now available)(?: to view)?)\b/i;

export function emailIntentRelevance(message: { subject: string; from: string; snippet: string }, intent: EmailIntent) {
  if (intent === "recruiter") return recruiterRelevance(message);
  const text = `${message.subject} ${message.from} ${message.snippet}`.toLowerCase();
  if (intent === "promotion") {
    let score = 0;
    if (/\b(sale|discount|coupon|promo(?:tional)?|offer|deal|save|% off|clearance|limited time)\b/.test(text)) score += 2;
    if (/unsubscribe|shop now|member offer|rewards?/.test(text)) score += 1;
    if (/\b(receipt|invoice|order confirmation|interview|application)\b/.test(text)) score -= 2;
    return score;
  }
  if (intent === "receipt") {
    const address = message.from.toLowerCase().match(/<([^>]+)>/)?.[1] ?? message.from.toLowerCase();
    const [local, domain = ""] = address.split("@");
    const subject = message.subject.toLowerCase();
    // R4.4: shipping and delivery notices are not receipts, even when they carry an order number.
    if (/\b(?:shipped|delivered|out for delivery|on its way|tracking)\b/.test(subject) && !/\b(?:receipt|invoice|order confirm)/.test(subject)) return -3;
    const lifecycleSubject = /^\W*(?:ordered|order (?:confirmed|confirmation))\b/.test(subject);
    // R4.1: a subject that itself names a receipt-type document is evidence, whoever sent it ("Your Google Play Order Receipt", "Purchase Confirmation").
    const strongSubject = STRONG_RECEIPT_SUBJECT.test(subject);
    const keyword = lifecycleSubject || strongSubject || /\b(receipt|invoice|order confirmation|payment received|orders?|payment confirmation|statement|tickets?)\b/.test(text);
    const amount = /\$\s?\d[\d,]*(?:\.\d{2})?/.test(text);
    const billingSender = /(bill|invoice|receipt|payment|order|statement|ship|track|confirm|deliver)/.test(local);
    const documentId = /\b(?:invoice|order|receipt)\s*(?:#|no\.?|number)?\s*:?\s*#?\s*(?=[a-z0-9-]*\d)[a-z0-9-]{5,}/.test(text);
    const marketingSender = /^(?:mail|news|marketing|offers?|promos?|promotions?|hello|info|deals?|rewards?|coupons?|specials?)/.test(local);
    // Bulk-mail subdomains (email.amctheatres.com, mail.adobe.com) only count when the message carries hard evidence.
    const marketingDomain = /^(?:email|e|em|mail|news|newsletter|marketing|info|offers?)\./.test(domain);
    const marketingText = /\b(?:reward|rewards|redeem|credit to use|next order|earn|bonus|financing|statement credit|apr|apply now|pre-?approved|limited time|% off|unsubscribe|newsletter|digest|coupon|sale)\b/.test(text);
    if (marketingSender || (marketingText && !(amount && billingSender))) return -3;
    if (marketingDomain && !(amount || documentId || lifecycleSubject || strongSubject)) return -3;
    // A receipt needs transaction evidence, not just the word "invoice" or "ticket" in a subject line.
    return keyword && (amount || billingSender || documentId || lifecycleSubject || strongSubject) ? 4 : 0;
  }
  return 1;
}

export function minimumEmailRelevance(intent: EmailIntent) {
  return intent === "general" ? 0 : 2;
}
