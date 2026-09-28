import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptText, decryptText } from "./encryption";
import { openFinancialFields, sealFinancialFields } from "./financial-data";
import { bankRecord } from "@/lib/plaid/service";

beforeEach(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", "test-encryption-key-with-at-least-32-bytes");
  vi.stubEnv("PII_HMAC_KEY", "independent-test-hmac-key-with-32-bytes");
});
describe("financial encryption boundaries", () => {
  const values = { occurred_on: "2026-09-27", amount_minor: 125899, currency: "USD", direction: "expense", category: "medical" };
  it("encrypts every transaction value and leaves no plaintext shadow columns", () => {
    const sealed = sealFinancialFields("finance_transactions", "owner", values);
    for (const key of Object.keys(values)) expect(sealed[key as keyof typeof sealed]).toBeNull();
    expect(sealed.financial_ciphertext).toMatch(/^v2:/);
    expect(openFinancialFields("finance_transactions", "owner", sealed)).toMatchObject(values);
    for (const value of Object.values(values)) expect(sealed.financial_ciphertext).not.toContain(String(value));
  });
  it("rejects ciphertext copied to another user's row or another financial table", () => {
    const row = sealFinancialFields("finance_transactions", "owner", values);
    expect(() => openFinancialFields("finance_transactions", "victim", row)).toThrow();
    expect(() => openFinancialFields("finance_bills", "owner", row)).toThrow();
  });
  it("authenticates ciphertext and never falls back to legacy plaintext on tampering", () => {
    const row = sealFinancialFields("finance_transactions", "owner", values);
    const parts = row.financial_ciphertext.split(":");
    const bytes = Buffer.from(parts[3], "base64url"); bytes[0] ^= 1; parts[3] = bytes.toString("base64url");
    expect(() => openFinancialFields("finance_transactions", "owner", { ...values, financial_ciphertext: parts.join(":") })).toThrow();
  });
  it("uses fresh IVs, reads existing v1 data, and handles empty plaintext", () => {
    expect(encryptText("same")).not.toBe(encryptText("same"));
    expect(decryptText(encryptText("legacy"))).toBe("legacy");
    expect(decryptText(encryptText(""))).toBe("");
    expect(() => decryptText(`${encryptText("secret")}:extra`)).toThrow();
  });
  it("does not send dates, pending state or ledger amounts to the bank database in plaintext", () => {
    const row = bankRecord("item", { transaction_id: "t", account_id: "account", amount: 1258.99, iso_currency_code: "USD", date: values.occurred_on, name: "Private clinic", pending: false }, "owner");
    expect(row.occurred_on).toBeNull(); expect(row.pending).toBeNull();
    expect(row.ledger_fields?.amount_minor).toBeNull();
    expect(JSON.stringify(row)).not.toContain("1258");
    expect(JSON.stringify(row)).not.toContain("Private clinic");
    expect(openFinancialFields("finance_transactions", "owner", row.ledger_fields!)).toMatchObject({ amount_minor: 125899 });
    expect(bankRecord("item", { transaction_id: "t", account_id: "a", amount: 1, iso_currency_code: "USD", date: values.occurred_on, name: "Shop", pending: true }, "owner").ledger_fields).toBeNull();
  });
});
it("rejects invalid money before encryption now that the database cannot inspect amounts", () => {
  expect(() => sealFinancialFields("finance_transactions", "owner", { occurred_on: "2026-09-27", amount_minor: -1, currency: "USD", direction: "expense", category: "other" })).toThrow();
  expect(() => sealFinancialFields("finance_transactions", "owner", { occurred_on: "invalid", amount_minor: 100, currency: "USD", direction: "expense", category: "other" })).toThrow();
});
