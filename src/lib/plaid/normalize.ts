import type { TransactionCandidate } from "@/lib/tools/finance/transactions";
import type { PlaidTransaction } from "./client";

// The existing Daylark ledger formats amounts in cents. Block other currencies
// rather than silently treating yen or three-decimal currencies as USD cents.
export function normalizeBankTransaction(t: PlaidTransaction): { candidate: TransactionCandidate | null; issue: string | null } {
  if (t.iso_currency_code !== "USD") return { candidate: null, issue: "Only USD bank transactions can currently be saved to Daylark." };
  const parts = String(Math.abs(t.amount)).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!parts) return { candidate: null, issue: "The amount needs review." };
  const cents = Number(parts[1]) * 100 + Number((parts[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents === 0) return { candidate: null, issue: "Zero or unsupported amount." };
  const primary = t.personal_finance_category?.primary || "";
  const detail = t.personal_finance_category?.detailed || "";
  const transfer = /^(TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS)$/.test(primary) || /CREDIT_CARD_PAYMENT/.test(detail);
  const direction = transfer ? "transfer" : t.amount < 0 ? "income" : "expense";
  const categories: Record<string, string> = {
    FOOD_AND_DRINK: "restaurants", TRANSPORTATION: "transport", TRAVEL: "transport", GENERAL_MERCHANDISE: "shopping",
    ENTERTAINMENT: "entertainment", MEDICAL: "health", RENT_AND_UTILITIES: "utilities",
  };
  const category = /GROCERIES/.test(detail) ? "groceries" : /RENT$/.test(detail) ? "housing" : categories[primary] || "other";
  return { candidate: {
    occurredOn: t.date, amountMinor: cents, currency: "USD", direction,
    merchant: t.merchant_name || t.name || "Bank transaction", category,
    note: direction === "transfer" ? "Bank-reported transfer or loan/card payment; excluded from spending." : t.amount < 0 ? "Bank-reported credit (may be a refund or income)." : "Imported from bank transactions.",
  }, issue: null };
}

export function comparableMerchant(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim(); }
