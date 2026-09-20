import { describe, expect, it } from "vitest";
import { cleanBodyText, stripHtml } from "@/lib/tools/email/google-gmail";
import { bulkImportQuery, deterministicOrderExtraction, orderPlacedOn, resolveBulkCandidate, senderDisplayName } from "./email-finance-import";
import { applyMerchantLearnings, guessCategory, toKnownCategory } from "@/lib/learning/preferences";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { buildEvidence, extractInvoiceFacts } from "./email-invoice";

const email = { subject: "Order Confirmed #946406863", from: "iHerb <noreply@info.iherb.com>", date: "Mon, 3 Aug 2026 10:15:00 -0700", snippet: "Order #946406863", text: "" };
const none = { isTransaction: false, amountMinor: null, currency: null, direction: null, merchant: null, category: null, occurredOn: null, note: null, missingFields: [] } as never;

describe("bulk import candidates (R8.6, R8.7)", () => {
  it("keeps a complete model extraction as is", () => {
    const result = resolveBulkCandidate({ ...(none as object), isTransaction: true, amountMinor: 2606, currency: "USD", direction: "expense", merchant: "iHerb", category: "shopping", occurredOn: "2026-08-03", note: null } as never, email);
    expect(result).toMatchObject({ candidate: { amountMinor: 2606, occurredOn: "2026-08-03" }, usedEmailDate: false });
  });
  it("falls back to a labeled body total, the sender name, and the email date", () => {
    const result = resolveBulkCandidate(none, { ...email, text: "Order Total: $26.06" });
    expect(result).toMatchObject({ candidate: { amountMinor: 2606, merchant: "iHerb", occurredOn: "2026-08-03" }, usedEmailDate: true });
  });
  it("never guesses an absent amount", () => {
    expect(resolveBulkCandidate(none, email)).toMatchObject({ reason: expect.stringContaining("no total found") });
  });
  it("rejects a non-purchase email even with an amount", () => {
    expect(resolveBulkCandidate(none, { ...email, subject: "Weekly favorites", text: "Total: $5.00" })).toEqual({ reason: "not a purchase record" });
  });
});

describe("reading totals from real-world email HTML (R8.9)", () => {
  it("decodes entity-encoded dollar signs before reading the total", () => {
    const text = stripHtml("<td>Order Total:</td><td>&#36;26.06</td><style>.a{}</style>");
    expect(text).toContain("$26.06");
    expect(extractInvoiceFacts({ subject: "", snippet: "", text }).amount).toBe("$26.06");
  });
  it("decodes hex and named entities and drops comments and head", () => {
    expect(stripHtml("<head><title>x</title></head><!-- hi --><p>Total&#x3a; &dollar;9.99&nbsp;paid</p>")).toBe("Total: $9.99 paid");
  });
  it("reads a suffix currency", () => {
    expect(extractInvoiceFacts({ subject: "", snippet: "", text: "Order Total: 35.53 USD" }).amount).toBe("$35.53");
  });
  it("uses the labeled total even when item prices are present", () => {
    expect(extractInvoiceFacts({ subject: "", snippet: "", text: "Item $20.00 Shipping $6.06 Order Total $26.06" }).amount).toBe("$26.06");
  });
});

describe("long emails where the total is deep in the body (R8.10)", () => {
  const tracking = Array.from({ length: 400 }, (_, index) => `https://click.iherb.com/track/${"x".repeat(60)}${index}`).join(" ");
  const long = `Thanks for shopping. ${tracking} Item Marine Collagen $19.00 Order Total: $26.06 Paid with Discover`;

  it("collapses tracking links so they cannot crowd out the content", () => {
    const cleaned = cleanBodyText(long);
    expect(cleaned.length).toBeLessThan(long.length / 10);
    expect(cleaned).toContain("$26.06");
  });
  it("keeps the total in the model evidence even when the email is far longer than the budget", () => {
    const filler = "Unrelated boilerplate sentence. ".repeat(2_500);
    const text = `${filler} Order Total: $26.06 ${filler}`;
    const evidence = buildEvidence({ subject: "Order Confirmed #946406863", from: "iHerb", date: "Mon, 3 Aug 2026", snippet: "", text });
    expect(evidence.length).toBeLessThanOrEqual(18_000);
    expect(evidence).toContain("$26.06");
  });
  it("still reads the total deterministically from the full text", () => {
    const text = `${"Unrelated boilerplate sentence. ".repeat(2_500)} Order Total: $26.06`;
    expect(extractInvoiceFacts({ subject: "", snippet: "", text }).amount).toBe("$26.06");
  });
});

describe("an order confirmation is dated when it was placed (R8.7)", () => {
  const model = { ...(none as object), isTransaction: true, amountMinor: 3553, currency: "USD", direction: "expense", merchant: "iHerb", category: "shopping", occurredOn: "2026-08-15", note: null } as never;
  const confirmation = { subject: "Order Confirmed #946705324", from: "iHerb <noreply@info.iherb.com>", date: "Fri, 14 Aug 2026 09:30:00 -0700", snippet: "", text: "" };
  it("uses the email's date, not an estimated ship date found in the body", () => {
    expect(orderPlacedOn(confirmation)).toBe("2026-08-14");
    expect(resolveBulkCandidate(model, confirmation)).toMatchObject({ candidate: { occurredOn: "2026-08-14" } });
  });
  it("keeps the document's own date for invoices and statements", () => {
    const invoice = { ...confirmation, subject: "Your Adobe invoice" };
    expect(orderPlacedOn(invoice)).toBeNull();
    expect(resolveBulkCandidate(model, invoice)).toMatchObject({ candidate: { occurredOn: "2026-08-15" } });
  });
});

describe("categories come from the fixed set (R14.4)", () => {
  it.each([["Health & Wellness", "health"], ["Health & Supplements", "health"], ["Shopping", "shopping"], ["Groceries & Household", "groceries"], ["Salary", "income"], ["Something Odd", "other"], ["", "other"]])("%s → %s", (raw, category) => expect(toKnownCategory(raw)).toBe(category));
  it("normalizes on every candidate, and a learned category still wins", () => {
    const base = { merchant: "iHerb", category: "Health & Wellness" };
    expect(applyMerchantLearnings(base, NO_LEARNINGS).candidate.category).toBe("health");
    const learned = { ...NO_LEARNINGS, merchantCategories: { iherb: "groceries" } };
    expect(applyMerchantLearnings(base, learned)).toMatchObject({ candidate: { category: "groceries" }, recategorized: true });
  });
});

describe("order confirmations import without a model (R9.4)", () => {
  const email = { subject: "Order Confirmed #946406863", from: "iHerb <noreply@info.iherb.com>", date: "Mon, 3 Aug 2026 10:15:00 -0700", snippet: "Order #946406863", text: "Thanks for your order. Item Marine Collagen $19.00 Shipping $7.06 Order Total: $26.06 Paid with Discover" };
  it("reads amount, date and merchant straight from the email", () => {
    expect(deterministicOrderExtraction(email)).toEqual({ isTransaction: true, amountMinor: 2606, currency: "USD", direction: "expense", merchant: "iHerb", category: "shopping", occurredOn: "2026-08-03", note: null, missingFields: [] });
  });
  it("gives the same answer every time", () => {
    expect(JSON.stringify(deterministicOrderExtraction(email))).toBe(JSON.stringify(deterministicOrderExtraction({ ...email })));
  });
  it.each([
    ["no readable total", { ...email, text: "Thanks for your order." }],
    ["several amounts and none labeled as the total", { ...email, text: "Item $19.00 Shipping $7.06" }],
    ["not an order confirmation", { ...email, subject: "Weekly favorites" }],
    ["no sender at all", { ...email, from: "" }],
  ])("falls back to the model when there is %s", (_name, input) => {
    expect(deterministicOrderExtraction(input)).toBeNull();
  });
  it("cleans the sender's display name", () => {
    expect(senderDisplayName('"Amazon.com" <auto-confirm@amazon.com>')).toBe("Amazon");
    expect(senderDisplayName("iHerb <noreply@info.iherb.com>")).toBe("iHerb");
  });
});

describe("merchant names for any sender (R8.11)", () => {
  it.each([
    ["DoorDash Order <orders@doordash.com>", "DoorDash"],
    ['"Amazon.com" <auto-confirm@amazon.com>', "Amazon"],
    ["Google Play <googleplay-noreply@google.com>", "Google Play"],
    ["iHerb <noreply@info.iherb.com>", "iHerb"],
    ["Uber Receipts <receipts@uber.com>", "Uber"],
    ["<noreply@yesbank.in>", "Yesbank"],
    ["DoNotReply@billpay.pge.com", "Pge"],
    ["", ""],
  ])("%s → %s", (from, name) => expect(senderDisplayName(from)).toBe(name));
  it("reads a labeled total on a receipt from any store", () => {
    const email = { subject: "Your receipt from Blue Bottle Coffee", from: "Blue Bottle <hello@bluebottle.com>", date: "Sat, 12 Sep 2026 08:10:00 -0700", snippet: "", text: "Thanks for stopping by. Subtotal $5.00 Tax $0.45 Total: $5.45" };
    expect(deterministicOrderExtraction(email)).toMatchObject({ merchant: "Blue Bottle", amountMinor: 545, occurredOn: "2026-09-12" });
  });
});

describe("category guess from the merchant (R14.4)", () => {
  it.each([
    ["DoorDash", "restaurants"], ["Uber Eats", "restaurants"], ["Uber", "transport"], ["Lyft", "transport"], ["Netflix", "entertainment"],
    ["Google Play", "entertainment"], ["PG&E", "utilities"], ["Xfinity", "utilities"], ["Heritage Park Apartments", "housing"], ["Safeway", "groceries"], ["CVS Pharmacy", "health"],
  ])("%s → %s", (merchant, category) => expect(guessCategory(merchant)).toBe(category));
  it("says nothing for an unknown merchant, so the default and the user's own corrections decide", () => {
    expect(guessCategory("iHerb")).toBeNull();
    expect(guessCategory("Blue Bottle")).toBeNull();
  });
  it("is used by the no-model path, with shopping as the fallback for a plain retailer", () => {
    const email = (from: string) => ({ subject: "Order Confirmed #1", from, date: "Sat, 12 Sep 2026 08:10:00 -0700", snippet: "", text: "Order Total: $10.00" });
    expect(deterministicOrderExtraction(email("DoorDash Order <orders@doordash.com>"))?.category).toBe("restaurants");
    expect(deterministicOrderExtraction(email("iHerb <noreply@iherb.com>"))?.category).toBe("shopping");
  });
});

describe("the Gmail search for a bulk import (free)", () => {
  it("keeps the sender and window when they are named", () => {
    expect(bulkImportQuery("iHerb", 30)).toBe('{from:"iHerb" "iHerb"} {subject:confirmed subject:confirmation subject:receipt subject:invoice subject:ordered subject:order} newer_than:30d');
  });
  it("sweeps every sender when none is named, looking for purchase and payment subjects in the window", () => {
    const query = bulkImportQuery(null, 7);
    expect(query).not.toContain("from:");
    expect(query).toContain("subject:receipt");
    expect(query).toContain("subject:payment");
    expect(query.endsWith("newer_than:7d")).toBe(true);
  });
});
