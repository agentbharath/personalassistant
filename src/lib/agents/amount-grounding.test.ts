import { describe, expect, it } from "vitest";
import { groundAmount, moneyAmountsIn } from "./amount-grounding";
import { resolveBulkCandidate } from "./email-finance-import";

const booking = {
  id: "m1", threadId: "t1", subject: "This is your receipt", from: "Booking.com <noreply@booking.com>", date: "Sun, 6 Sep 2026 10:15:00 -0700", receivedAt: Date.parse("2026-09-06T17:15:00Z"), snippet: "",
  text: "Thanks for booking. Your stay is confirmed for Sep 6, 2026. Price details 1 Queen Room with Two Queen Beds - Hearing Accessible/Non-Smoking $135.15 Other tax $17.57 Total Price $152.72 Payment info Total cost $152.72 Total paid $152.72 Booking.com 2026",
  attachments: [],
};
const model = (amountMinor: number) => ({ isTransaction: true, amountMinor, currency: "USD", direction: "expense" as const, merchant: "Booking", category: "shopping", occurredOn: "2026-09-06", note: null, missingFields: [] });

describe("an amount must be shown as money in the email (free)", () => {
  it("finds amounts with a currency mark, with thousands separators, and bare numbers with two decimals", () => {
    expect([...moneyAmountsIn("Total $152.72 and $2,026.00, tax 17.57, USD 20, €5.50")].sort((a, b) => a - b)).toEqual([500 + 50, 2000, 1757, 15272, 202600].sort((a, b) => a - b));
  });

  it("does not take a year, a date, an order number or a phone number for money", () => {
    expect(moneyAmountsIn("Sep 6, 2026 · Order #2026 · Call 800-555-2026 · Booking.com 2026 · 12/06/2026").size).toBe(0);
  });

  it("uses the model's amount when the email shows it, and otherwise the amount the plain rules found", () => {
    expect(groundAmount(15272, booking.text, 15272)).toBe(15272);
    expect(groundAmount(202600, booking.text, 15272)).toBe(15272); // the year read as $2,026.00
    expect(groundAmount(202600, booking.text, null)).toBeNull();
    expect(groundAmount(null, booking.text, 13515)).toBe(13515);
  });

  it("stops a Booking receipt from being imported as $2,026.00", () => {
    const resolved = resolveBulkCandidate(model(202600) as never, booking as never);
    expect("candidate" in resolved && resolved.candidate.amountMinor).toBe(15272);
  });

  it("keeps a correct amount, and asks for the total when the email shows none", () => {
    const ok = resolveBulkCandidate(model(15272) as never, booking as never);
    expect("candidate" in ok && ok.candidate.amountMinor).toBe(15272);
    const none = resolveBulkCandidate(model(202600) as never, { ...booking, text: "Your stay is confirmed for Sep 6, 2026. Thanks for booking." } as never);
    expect(none).toMatchObject({ reason: expect.stringMatching(/no total found/) });
  });
});
