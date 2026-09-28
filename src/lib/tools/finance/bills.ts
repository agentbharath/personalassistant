import { assertToolAllowed } from "@/lib/agents/registry";
import { currentOutstandingBills, type Bill } from "@/lib/agents/bills";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTransactionCandidate, type TransactionSource } from "./transactions";

export type BillCandidate = { merchant: string; amountMinor: number; currency: string; category: string; statementDate: string; dueDate: string | null; paymentDirection?: "expense" | "transfer"; accountLastFour?: string | null };

const COLUMNS = "id, merchant_ciphertext, amount_minor, currency, category, statement_date, due_date, status, paid_on, payload_ciphertext";
const normalizeMerchant = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

type Row = { id: string; merchant_ciphertext: string; amount_minor: number | string; currency: string; category: string; statement_date: string; due_date: string | null; status: "outstanding" | "paid"; paid_on: string | null; payload_ciphertext?: string | null };
function decode(row: Row): Bill {
  let paymentDirection: "expense" | "transfer" = "expense";
  let accountLastFour: string | null = null;
  if (row.payload_ciphertext) {
    const text = decryptText(row.payload_ciphertext);
    try {
      const payload = JSON.parse(text) as { paymentDirection?: string; accountLastFour?: string };
      if (payload?.paymentDirection === "transfer") paymentDirection = "transfer";
      if (payload?.accountLastFour && /^\d{4}$/.test(payload.accountLastFour)) accountLastFour = payload.accountLastFour;
    } catch { /* Older bill evidence could be plain text. */ }
  }
  return { id: row.id, merchant: decryptText(row.merchant_ciphertext), amountMinor: Number(row.amount_minor), currency: row.currency, category: row.category, statementDate: row.statement_date, dueDate: row.due_date, status: row.status, paidOn: row.paid_on, paymentDirection, accountLastFour };
}

/** R17.2: a bill is a liability, so it is stored apart from expenses and counts as spending only when paid. */
export async function createBill(userId: string, candidate: BillCandidate, source: { externalRef?: string; payload?: string } = {}) {
  assertToolAllowed("finance", "finance.create_bill");
  const admin = createAdminClient();
  const currency = candidate.currency.toUpperCase();
  const fingerprint = piiHmac([candidate.statementDate, candidate.amountMinor, currency, normalizeMerchant(candidate.merchant), ...(candidate.accountLastFour ? [candidate.accountLastFour] : [])].join("|"));
  const existing = await admin.from("finance_bills").select(COLUMNS).eq("user_id", userId).eq("dedupe_fingerprint", fingerprint).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { bill: decode(existing.data as Row), duplicate: true };
  const { data, error } = await admin.from("finance_bills").insert({
    user_id: userId,
    merchant_ciphertext: encryptText(candidate.merchant),
    merchant_hash: piiHmac(normalizeMerchant(candidate.merchant)),
    amount_minor: candidate.amountMinor,
    currency,
    category: candidate.category,
    statement_date: candidate.statementDate,
    due_date: candidate.dueDate,
    dedupe_fingerprint: fingerprint,
    source_ref_hmac: source.externalRef ? piiHmac(source.externalRef) : null,
    payload_ciphertext: encryptText(JSON.stringify({ sourcePayload: source.payload ?? null, paymentDirection: candidate.paymentDirection ?? "expense", accountLastFour: candidate.accountLastFour ?? null })),
  }).select(COLUMNS).single();
  if (error) {
    if (error.code === "23505") return createBill(userId, candidate, source);
    throw error;
  }
  return { bill: decode(data as Row), duplicate: false };
}

export async function listBills(userId: string, status?: "outstanding" | "paid"): Promise<Bill[]> {
  assertToolAllowed("finance", "finance.list_bills");
  const rows: Row[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = createAdminClient().from("finance_bills").select(COLUMNS).eq("user_id", userId)
      .order("statement_date", { ascending: false }).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (status === "paid") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const bills = rows.map(decode);
  return status === "outstanding" ? currentOutstandingBills(bills) : bills;
}

/** R17.4, R17.5: marking a bill paid creates exactly one expense, dated on the payment, and links it to the bill. */
/** `direction` is "transfer" when the bill is a credit card statement: paying it is not new spending. */
export async function settleBill(userId: string, billId: string, paidOn: string, source: TransactionSource = { type: "user_input" }, direction?: "expense" | "transfer", payment?: { amountMinor: number; currency: string; accountLastFour?: string | null }) {
  assertToolAllowed("finance", "finance.settle_bill");
  const admin = createAdminClient();
  const found = await admin.from("finance_bills").select(COLUMNS).eq("id", billId).eq("user_id", userId).single();
  if (found.error) throw found.error;
  const bill = decode(found.data as Row);
  if (payment && (payment.amountMinor !== bill.amountMinor || payment.currency !== bill.currency || (payment.accountLastFour ?? null) !== (bill.accountLastFour ?? null))) throw new Error("PAYMENT_DOES_NOT_MATCH_BILL");
  if (source.type === "email" && !payment) throw new Error("PAYMENT_DETAILS_REQUIRED");
  if (bill.status === "paid") return { bill, duplicate: true, transactionId: null as string | null };
  direction = bill.paymentDirection === "transfer" ? "transfer" : direction ?? "expense";
  const result = await createTransactionCandidate(userId, {
    occurredOn: paidOn, amountMinor: payment?.amountMinor ?? bill.amountMinor, currency: payment?.currency ?? bill.currency, direction, merchant: bill.merchant, category: bill.category, note: direction === "transfer" ? "Credit card payment" : "Bill payment",
  }, source);
  const updated = await admin.from("finance_bills").update({ status: "paid", paid_on: paidOn, paid_transaction_id: result.transaction.id, updated_at: new Date().toISOString() }).eq("id", billId).eq("user_id", userId).eq("status", "outstanding").select(COLUMNS).single();
  if (updated.error) throw updated.error;
  return { bill: decode(updated.data as Row), duplicate: result.duplicate, transactionId: result.transaction.id };
}
