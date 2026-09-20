import { describe, expect, it } from "vitest";
import { extractRequestedSender, toGmailQuery } from "./email-query";

describe("semantic Gmail query construction", () => {
  it("expands recruiter intent instead of requiring the literal word", () => {
    const query = toGmailQuery("have I got any mails from recruiters today", "America/Los_Angeles");
    expect(query).toContain('recruiter recruiting "talent acquisition" hiring interview opportunity staffing sourcer');
    expect(query).toMatch(/after:\d{4}\/\d{2}\/\d{2} before:\d{4}\/\d{2}\/\d{2}/);
    expect(extractRequestedSender("have I got any mails from recruiters today")).toBeNull();
  });

  it("keeps an explicit organization sender and today boundary", () => {
    const query = toGmailQuery("emails from Amazon today", "America/Los_Angeles");
    expect(query).toContain('{from:"Amazon" "Amazon"}');
    expect(query).toContain("after:");
  });

  it("expands promotional intent beyond an exact word match", () => {
    const query = toGmailQuery("have I got any promotion mails", "America/Los_Angeles");
    expect(query).toContain("category:promotions");
    expect(query).toContain("discount");
    expect(query).toContain("coupon");
  });
});

describe("sender extraction stops at conjunctions", () => {
  it("finds Adobe in an invoice lookup and puts it in the Gmail query", () => {
    const input = "Find the latest invoice from Adobe and tell me the amount and billing date.";
    expect(extractRequestedSender(input)).toBe("Adobe");
    expect(toGmailQuery(input)).toContain('from:"Adobe"');
  });
});
