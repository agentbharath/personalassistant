import { describe, expect, it } from "vitest";
import { planClauseInstructions } from "@/lib/orchestrator/multi-agent";
import { deterministicReadOnlyAgents, isEmailMutation } from "@/lib/orchestrator/routing";
import { toGmailQuery as gmailQuery, exclusionTerms, extractRequestedSender, fixDomainTypos, toGmailQuery } from "./email-query";
import { classifyDeterministically } from "@/lib/orchestrator/intent";
import { isEmailFinanceImport } from "@/lib/orchestrator/routing";
import { requestedMerchant } from "./finance";
import { detectEmailIntent, emailIntentRelevance, minimumEmailRelevance } from "./email-relevance";

describe("complex email queries", () => {
  it("treats 'skip anything promotional' as an exclusion, not the topic", () => {
    const input = "Show receipts from my last 30 days of emails, but skip anything promotional.";
    expect(detectEmailIntent(input)).toBe("receipt");
    expect(extractRequestedSender(input)).toBeNull();
    const query = toGmailQuery(input);
    expect(query).toContain("newer_than:30d");
    expect(query).toContain("-category:promotions");
    expect(query).not.toContain("from:");
  });

  it("finds the brand in 'my Amazon order' and prefers the receipt reading over 'promotion'", () => {
    const input = "Did my Amazon order confirmation arrive, or was it just a promotion for a similar product?";
    expect(detectEmailIntent(input)).toBe("receipt");
    expect(extractRequestedSender(input)).toBe("Amazon");
  });

  it("does not mistake leading verbs for a brand", () => {
    expect(extractRequestedSender("Show receipts from the past 30 days")).toBeNull();
    expect(extractRequestedSender("Find invoice details")).toBeNull();
  });

  it("repairs domain typos without touching the brand", () => {
    const fixed = fixDomainTypos("find latest invoic from adobee and tel me the totl");
    expect(fixed).toContain("invoice");
    expect(fixed).toContain("total");
    expect(fixed).toContain("adobee");
  });

  it("collects excluded topics but never the requested sender's own name", () => {
    expect(exclusionTerms("Emails from PG&E this week that are actual statements, not climate credit or safety notices.", "PG&E")).toEqual(["climate", "credit", "safety"]);
    expect(exclusionTerms("Any emails from Amazon Web Services today, not regular Amazon?", "Amazon Web Services")).toEqual([]);
  });

  it("declines email writes but leaves calendar cancellations alone", () => {
    expect(isEmailMutation("Delete the Adobe invoice email.")).toBe(true);
    expect(isEmailMutation("Forward my latest invoice to alex@abc.com")).toBe(true);
    expect(isEmailMutation("Cancel my 2 PM meeting and email everyone that I'm sorry.")).toBe(false);
    expect(isEmailMutation("Show my latest emails")).toBe(false);
  });
});

describe("compound requests are split per agent", () => {
  it("gives the concert search only its own clause and defers the calendar", () => {
    const input = "Find the Anirudh concert in Dallas, check I'm free, find my ticket receipt, and invite alex@abc.com.";
    const agents = deterministicReadOnlyAgents(input);
    expect(agents).toEqual(expect.arrayContaining(["general", "email", "calendar"]));
    const { tasks, notes } = planClauseInstructions(input, agents);
    expect(tasks.find((task) => task.agent === "general")?.instruction).toBe("Find the Anirudh concert in Dallas");
    expect(tasks.find((task) => task.agent === "email")?.instruction).toBe("find my ticket receipt");
    expect(tasks.some((task) => task.agent === "calendar")).toBe(false);
    expect(notes.join(" ")).toContain("alex@abc.com");
  });

  it("keeps the calendar clause when it names a day", () => {
    const input = "Am I free Saturday at 3, and did the venue email me a ticket for it?";
    const { tasks } = planClauseInstructions(input, deterministicReadOnlyAgents(input));
    expect(tasks.find((task) => task.agent === "calendar")?.instruction).toBe("Am I free Saturday at 3");
    expect(tasks.find((task) => task.agent === "email")?.instruction).toBe("did the venue email me a ticket for it");
  });
});

describe("order mail versus marketing", () => {
  const passes = (message: { subject: string; from: string; snippet: string }) => emailIntentRelevance(message, "receipt") >= minimumEmailRelevance("receipt");
  it("accepts an Amazon order confirmation but not its shipping notice (R4.4)", () => {
    expect(passes({ subject: "Ordered: \"Casio Men's AE-1200WHD-1AV...\"", from: "Amazon.com <auto-confirm@amazon.com>", snippet: "Thanks for your order." })).toBe(true);
    expect(passes({ subject: "Shipped: \"Casio Men's AE-1200WHD-1AV...\"", from: "Amazon.com <shipment-tracking@amazon.com>", snippet: "Your package was shipped!" })).toBe(false);
  });
  it("rejects a theater's weekly promo even though it says ticket", () => {
    expect(passes({ subject: "Bharath Kumar, Your Weekly Ticket Is Here", from: "AMC Theatres <noreply@email.amctheatres.com>", snippet: "Evil breaks loose this weekend." })).toBe(false);
  });
});

describe("merchant spend questions", () => {
  it.each([
    ["how much have i spend iherb", "iherb"],
    ["How much did I spend on Adobe?", "Adobe"],
    ["what did I spend at Curry Point this month", "Curry Point"],
  ])("finds the merchant in %s", (input, merchant) => {
    expect(requestedMerchant(input)).toBe(merchant);
  });
  it.each(["how much did I spend this month", "what are my spendings on restaurants", "how much have I spent so far"])("finds no merchant in %s", (input) => {
    expect(requestedMerchant(input)).toBeNull();
  });
});

describe("store order mail", () => {
  const passes = (message: { subject: string; from: string; snippet: string }) => emailIntentRelevance(message, "receipt") >= minimumEmailRelevance("receipt");
  it("accepts an iHerb order confirmation identified only by its order number", () => {
    expect(passes({ subject: "Thank you for your iHerb order 947597212", from: "iHerb <iherb@iherb.com>", snippet: "Your order is confirmed." })).toBe(true);
  });
  it("still rejects an iHerb sale email", () => {
    expect(passes({ subject: "Save 20% on collagen this weekend", from: "iHerb <deals@iherb.com>", snippet: "Limited time offer, shop now." })).toBe(false);
  });
});

describe("store receipts without a verb", () => {
  it("repairs the typo and finds a lowercase store name", () => {
    const input = fixDomainTypos("all iherb recipts");
    expect(input).toBe("all iherb receipts");
    expect(extractRequestedSender(input)).toBe("iherb");
    expect(detectEmailIntent(input)).toBe("receipt");
  });
  it("does not treat an adjective before receipts as a store", () => {
    expect(extractRequestedSender("Did I receive any duplicate receipts or invoices for the same purchase?")).toBeNull();
    expect(extractRequestedSender("show me recent invoices")).toBeNull();
  });
  it("routes a bare receipt list to email, not finance", () => {
    expect(classifyDeterministically("all iherb receipts")?.intents[0].agent).toBe("email");
  });
});

describe("iHerb screenshot regressions", () => {
  const passes = (message: { subject: string; from: string; snippet: string }) => emailIntentRelevance(message, "receipt") >= minimumEmailRelevance("receipt");
  it("rejects the $5 reward promo but keeps the order confirmation", () => {
    expect(passes({ subject: "**A $5 USD reward to enjoy ✦ **", from: "iHerb <promos@wellness.iherb.com>", snippet: "A credit to use on your next order" })).toBe(false);
    expect(passes({ subject: "Order Confirmed #947597212", from: "iHerb <noreply@info.iherb.com>", snippet: "Order #947597212" })).toBe(true);
  });
  it("routes 'i mean import all iherb recipts' to the email import flow", () => {
    expect(isEmailFinanceImport(fixDomainTypos("i mean import all iherb recipts"))).toBe(true);
    expect(extractRequestedSender(fixDomainTypos("i mean import all iherb recipts"))).toBe("iherb");
  });
});

describe("receipt searches target confirmation subjects (R4.6)", () => {
  it("uses subject-targeted terms and keeps the sender and window", async () => {
    const { toGmailQuery } = await import("./email-query");
    const query = toGmailQuery("show all iherb receipts last 365 days");
    expect(query).toContain('from:"iherb"');
    expect(query).toContain("subject:confirmed");
    expect(query).toContain("subject:receipt");
    expect(query).toContain("newer_than:365d");
    expect(query).not.toContain("{receipt invoice purchase order");
  });
  it("leaves non-receipt searches alone", async () => {
    const { toGmailQuery } = await import("./email-query");
    expect(toGmailQuery("promotional emails from Amazon")).toContain("category:promotions");
    expect(toGmailQuery("promotional emails from Amazon")).not.toContain("subject:confirmed");
  });
});
