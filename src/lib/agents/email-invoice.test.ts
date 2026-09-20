import { describe, expect, it } from "vitest";
import { asksForInvoiceFacts, extractInvoiceFacts } from "./email-invoice";

describe("invoice fact extraction", () => {
  it("reads a labeled total and billing date", () => {
    const facts = extractInvoiceFacts({ subject: "Your Adobe invoice", snippet: "", text: "Invoice date: Sep 3, 2026\nSubtotal $49.99\nTax $5.00\nTotal: $54.99" });
    expect(facts).toEqual({ amount: "$54.99", billingDate: "Sep 3, 2026", dateLabel: "invoice date" });
  });
  it("uses the only amount when nothing is labeled", () => {
    expect(extractInvoiceFacts({ subject: "Receipt", snippet: "You paid $1,299.00", text: "" }).amount).toBe("$1,299.00");
  });
  it("refuses to guess between several unlabeled amounts", () => {
    expect(extractInvoiceFacts({ subject: "Receipt", snippet: "", text: "Item $10.00 and item $20.00" }).amount).toBeNull();
  });
  it("parses numeric dates", () => {
    expect(extractInvoiceFacts({ subject: "", snippet: "", text: "Billed on 09/17/2026" }).billingDate).toBe("Sep 17, 2026");
  });
  it("detects when the user wants facts, not a list", () => {
    expect(asksForInvoiceFacts("Find the latest invoice from Adobe and tell me the amount and billing date.")).toBe(true);
    expect(asksForInvoiceFacts("Show receipts from the past 30 days")).toBe(false);
  });
});
