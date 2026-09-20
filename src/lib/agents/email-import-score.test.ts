import { describe, expect, it } from "vitest";
import { documentScore, isLikelyRequestedDocument } from "./email-finance-import";

const input = "import my latest iherb receipt";

describe("email import scoring for store orders", () => {
  it("accepts an order confirmation identified by its order number", () => {
    expect(documentScore({ subject: "Thank you for your iHerb order 947597212", snippet: "Your order is confirmed." }, input)).toBeGreaterThanOrEqual(5);
  });
  it("ranks the confirmation above the shipped notice, which alone is not enough", () => {
    const confirmation = documentScore({ subject: "Thank you for your iHerb order 947597212", snippet: "" }, input);
    const shipped = documentScore({ subject: "Your iHerb order 947597212 has shipped", snippet: "" }, input);
    expect(confirmation).toBeGreaterThan(shipped);
    expect(shipped).toBeLessThan(5);
  });
  it("rejects a sale email", () => {
    expect(documentScore({ subject: "Save 20% off collagen - sale ends tonight", snippet: "order now" }, input)).toBeLessThan(5);
  });
  it("still accepts explicit receipts", () => {
    expect(documentScore({ subject: "Your receipt from Adobe", snippet: "" }, "import my adobe receipt")).toBeGreaterThanOrEqual(5);
  });
  it("treats an order email with an order number and a total as a purchase record", () => {
    expect(isLikelyRequestedDocument({ subject: "Thank you for your iHerb order 947597212", snippet: "", text: "Order 947597212. Item total $35.53" }, input)).toBe(true);
    expect(isLikelyRequestedDocument({ subject: "Weekly favorites", snippet: "", text: "New arrivals just for you" }, input)).toBe(false);
  });
});
