import { describe, expect, it } from "vitest";
import { resolveEmailFollowUp } from "./email-followup";
import { parseEmailRequest } from "./email-request";

const parsed = (input: string, context: Parameters<typeof resolveEmailFollowUp>[1]) => parseEmailRequest(resolveEmailFollowUp(input, context) ?? "");
import { extractRequestedSender, recencyDays, toGmailQuery } from "./email-query";
import { emailIntentRelevance, minimumEmailRelevance } from "./email-relevance";

const invoiceContext = [
  { role: "user" as const, content: "Find the latest invoice from Adobe and tell me the amount and billing date." },
  { role: "assistant" as const, content: "### Matching email\n\n- **Invoice**\n  Adobe Acrobat <mail@mail.adobe.com> · Jun 16, 2026" },
];

describe("email follow-ups", () => {
  it("keeps the invoice subject for a new sender", () => {
    expect(parsed("how about from pinterest. any emails?", invoiceContext)).toMatchObject({ sender: "pinterest", topic: "receipt" });
  });
  it("corrects typos against senders already in the conversation", () => {
    expect(parsed("hoe about adobee", invoiceContext)).toMatchObject({ sender: "Adobe", topic: "receipt" });
  });
  it("ignores follow-up phrasing when the conversation was not about email", () => {
    expect(resolveEmailFollowUp("how about pizza", [{ role: "user", content: "best restaurants nearby" }])).toBeNull();
  });
  it("does not swallow trailing words into the sender", () => {
    expect(extractRequestedSender("emails from pinterest. any emails?")).toBe("pinterest");
  });
});

describe("marketing is not an invoice", () => {
  const marketing = { subject: "Easy on the eyes, and easier to share", from: "Adobe Acrobat <mail@mail.adobe.com>", snippet: "Turn your invoice into a memorable PDF. Let your work fly." };
  it("rejects Adobe Acrobat promo mail", () => {
    expect(emailIntentRelevance(marketing, "receipt")).toBeLessThan(minimumEmailRelevance("receipt"));
  });
  it("accepts a billing email with an order number", () => {
    const real = { subject: "Your Adobe invoice", from: "Adobe <message@adobe.com>", snippet: "Invoice number: IN12345678 for your Creative Cloud plan" };
    expect(emailIntentRelevance(real, "receipt")).toBeGreaterThanOrEqual(minimumEmailRelevance("receipt"));
  });
});

describe("period and filter refinements", () => {
  const awsContext = [
    { role: "user" as const, content: "Any emails from Amazon Web Services today, not regular Amazon?" },
    { role: "assistant" as const, content: "Nothing today. The most recent match is: ..." },
  ];
  it("keeps the sender and exclusion when only a period is given", () => {
    expect(parsed("from. last one month", awsContext)).toMatchObject({ sender: "Amazon Web Services", days: 30 });
    expect(parsed("what about last week?", awsContext)).toMatchObject({ sender: "Amazon Web Services", days: 7 });
  });
  it("chains refinements back to the original query", () => {
    const chained = [...awsContext, { role: "user" as const, content: "from. last one month" }, { role: "assistant" as const, content: "..." }];
    expect(parsed("only unread", chained)).toMatchObject({ sender: "Amazon Web Services", days: 30, unread: true });
  });
  it("does not hijack a standalone query or a non-email conversation", () => {
    expect(resolveEmailFollowUp("show emails from Google last month", awsContext)).toBeNull();
    expect(resolveEmailFollowUp("last month", [{ role: "user", content: "best pizza nearby" }])).toBeNull();
  });
});

describe("recency parsing", () => {
  it.each([["last one month", 30], ["past 2 weeks", 14], ["last 30 days", 30], ["last week", 7], ["last year", 365]])("%s → %i days", (phrase, days) => {
    expect(recencyDays(phrase)).toBe(days);
  });
  it("puts the period and unread filter in the Gmail query", () => {
    expect(toGmailQuery("Amazon Web Services emails from Amazon Web Services last 30 days unread")).toContain("newer_than:30d");
    expect(toGmailQuery("Amazon Web Services emails from Amazon Web Services last 30 days unread")).toContain("is:unread");
  });
});
