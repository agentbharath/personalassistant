import { describe, expect, it } from "vitest";
import { normalizeBankTransaction } from "./normalize";
import type { PlaidTransaction } from "./client";

const charge: PlaidTransaction = { transaction_id: "t", account_id: "a", amount: 19.99, iso_currency_code: "USD", date: "2026-09-20", pending: false, name: "SHOP", merchant_name: "Shop" };
describe("bank money and directions", () => {
  it("preserves cents without floating point drift", () => {
    expect(normalizeBankTransaction(charge).candidate?.amountMinor).toBe(1999);
    expect(normalizeBankTransaction({ ...charge, amount: 0.29 }).candidate?.amountMinor).toBe(29);
  });
  it("keeps credits separate from positive expenses", () => {
    expect(normalizeBankTransaction({ ...charge, amount: -19.99 }).candidate).toMatchObject({ direction: "income", amountMinor: 1999 });
  });
  it.each(["LOAN_PAYMENTS", "TRANSFER_IN", "TRANSFER_OUT"])("does not count %s as spending", primary => {
    expect(normalizeBankTransaction({ ...charge, personal_finance_category: { primary, detailed: "" } }).candidate?.direction).toBe("transfer");
  });
  it("blocks unsupported currencies and fractional cents", () => {
    for (const change of [{ iso_currency_code: "JPY" }, { iso_currency_code: null }, { amount: 0.001 }, { amount: 0 }])
      expect(normalizeBankTransaction({ ...charge, ...change }).candidate).toBeNull();
  });
});

it.each([
 ["FOOD_AND_DRINK_GROCERIES","groceries"],
 ["FOOD_AND_DRINK_RESTAURANT","restaurants"],
 ["FOOD_AND_DRINK_COFFEE","coffee"],
])("preserves the bank's detailed food category %s",(detailed,category)=>{
 expect(normalizeBankTransaction({...charge,personal_finance_category:{primary:"FOOD_AND_DRINK",detailed}}).candidate?.category).toBe(category);
});
