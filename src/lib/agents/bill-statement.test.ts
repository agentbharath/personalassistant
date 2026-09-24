import { describe, expect, it } from "vitest";
import { resolveBillStatement, validateBillStatement, type BillStatement } from "./bill-statement";

const statement: BillStatement = { isBill: true, amountMinor: 123456, currency: "USD", merchant: "Local Bank", statementDate: "2026-09-01", dueOn: "2026-10-05", kind: "credit_card", accountLastFour: "1234" };

describe("statement evidence", () => {
  it("uses the extracted full balance when a minimum payment is also shown", () => {
    expect(resolveBillStatement(statement, "Minimum payment $25.00. New statement balance $1,234.56")).toMatchObject({ candidate: { amountMinor: 123456, direction: "transfer" } });
  });
  it("never substitutes a minimum payment when the full balance is absent", () => {
    expect(resolveBillStatement({ ...statement, amountMinor: null }, "Minimum payment $25.00")).toHaveProperty("reason");
    expect(resolveBillStatement(statement, "Minimum payment $25.00")).toHaveProperty("reason");
  });
  it("reads attached evidence without requiring the balance in the email body", () => {
    expect(resolveBillStatement(statement, "", true)).toHaveProperty("candidate");
  });
  it("keeps utilities as expenses and leaves absent due dates unknown", () => {
    const value = validateBillStatement({ ...statement, kind: "utility", dueOn: null });
    expect(value.dueOn).toBeNull();
    expect(resolveBillStatement(value, "$1,234.56")).toMatchObject({ candidate: { direction: "expense", category: "utilities" } });
  });
  it("rejects paid receipts and missing issuer or billing dates", () => {
    for (const over of [{ isBill: false }, { merchant: null }, { statementDate: null }, { currency: null }]) {
      expect(resolveBillStatement({ ...statement, ...over }, "$1,234.56")).toHaveProperty("reason");
    }
  });
  it("rejects invalid dates, currency and full account numbers from the model", () => {
    for (const over of [{ dueOn: "2026-02-30" }, { statementDate: "tomorrow" }, { currency: "$" }, { accountLastFour: "1234567890" }, { amountMinor: -1 }]) {
      expect(() => validateBillStatement({ ...statement, ...over })).toThrow();
    }
  });
});
