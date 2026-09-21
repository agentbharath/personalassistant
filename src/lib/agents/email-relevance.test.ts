import { describe, expect, it } from "vitest";
import { detectEmailIntent, emailIntentRelevance, minimumEmailRelevance, recruiterRelevance } from "./email-relevance";

describe("recruiter email relevance", () => {
  it("accepts a concrete recruiter message", () => {
    expect(recruiterRelevance({ subject: "Interview opportunity for Senior Engineer", from: "Jane, Talent Acquisition <jane@example.com>", snippet: "We reviewed your profile and would like to schedule an interview." })).toBeGreaterThanOrEqual(2);
  });

  it("rejects promotional newsletters containing weak opportunity language", () => {
    expect(recruiterRelevance({ subject: "Weekly developer digest", from: "newsletter@example.com", snippet: "Sale, news, and opportunities from our community roundup." })).toBeLessThan(2);
  });
});

describe("email intent relevance", () => {
  it("recognizes promotion requests and accepts a concrete sale", () => {
    const intent = detectEmailIntent("have I got any promotion mails");
    expect(intent).toBe("promotion");
    expect(emailIntentRelevance({ subject: "20% off this weekend", from: "offers@store.com", snippet: "Limited-time member sale. Unsubscribe" }, intent)).toBeGreaterThanOrEqual(2);
  });

  it("rejects a recruiter message from promotional results", () => {
    expect(emailIntentRelevance({ subject: "Interview for engineer", from: "Talent Acquisition", snippet: "We reviewed your application" }, "promotion")).toBeLessThan(2);
  });
});

describe("receipt relevance requires transaction evidence", () => {
  it("rejects a financing promotion that only mentions purchase", () => {
    const promo = { subject: "Make your next purchase with 0% APR financing", from: "offers@store.com", snippet: "Apply now. Limited time." };
    expect(emailIntentRelevance(promo, "receipt")).toBeLessThan(minimumEmailRelevance("receipt"));
  });
  it("accepts a real receipt", () => {
    const receipt = { subject: "Your receipt from Adobe", from: "billing@adobe.com", snippet: "Payment received $54.99" };
    expect(emailIntentRelevance(receipt, "receipt")).toBeGreaterThanOrEqual(minimumEmailRelevance("receipt"));
  });
  it("accepts a booking confirmation as a purchase record", () => {
    for (const subject of ["Your booking in San Francisco is confirmed", "Booking.com: Your reservation is confirmed"]) {
      expect(emailIntentRelevance({ subject, from: "Booking.com <noreply@mail.booking.com>", snippet: "Total price US$412.00" }, "receipt")).toBeGreaterThanOrEqual(minimumEmailRelevance("receipt"));
    }
  });
});
