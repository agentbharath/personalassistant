import { assertToolAllowed } from "@/lib/agents/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";

export type TransactionCandidate = {
  occurredOn: string;
  amountMinor: number;
  currency: string;
  direction: "expense" | "income";
  merchant: string;
  category: string;
  note?: string | null;
};

export type StoredTransaction = TransactionCandidate & { id: string };
export type TransactionSource = { type: "user_input" | "receipt" | "email"; externalRef?: string; payload?: string };

function normalizeMerchant(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function fingerprint(candidate: TransactionCandidate) {
  return piiHmac([
    candidate.occurredOn,
    candidate.amountMinor,
    candidate.currency.toUpperCase(),
    candidate.direction,
    normalizeMerchant(candidate.merchant),
  ].join("|"));
}

function nearbyDates(date: string) {
  const center = new Date(`${date}T12:00:00Z`);
  const shift = (days: number) => new Date(center.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return { from: shift(-3), to: shift(3) };
}

export async function createTransactionCandidate(userId: string, candidate: TransactionCandidate, source: TransactionSource = { type: "user_input" }) {
  assertToolAllowed("finance", "finance.create_candidate");
  const supabase = createAdminClient();
  if (source.externalRef) {
    const { data: linkedSource, error: sourceLookupError } = await supabase
      .from("finance_transaction_sources")
      .select("transaction_id")
      .eq("user_id", userId)
      .eq("source_type", source.type)
      .eq("external_ref_hmac", piiHmac(source.externalRef))
      .maybeSingle();
    if (sourceLookupError) throw sourceLookupError;
    if (linkedSource) {
      const { data: linkedTransaction, error: linkedError } = await supabase
        .from("finance_transactions")
        .select("id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, category, note_ciphertext")
        .eq("id", linkedSource.transaction_id)
        .eq("user_id", userId)
        .single();
      if (linkedError) throw linkedError;
      return { transaction: decode(linkedTransaction), duplicate: true, duplicateKind: "source" as const };
    }
  }
  const currency = candidate.currency.toUpperCase();
  const dedupeFingerprint = fingerprint({ ...candidate, currency });
  const { data: exact, error: exactError } = await supabase
    .from("finance_transactions")
    .select("id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, category, note_ciphertext")
    .eq("user_id", userId)
    .eq("dedupe_fingerprint", dedupeFingerprint)
    .maybeSingle();
  if (exactError) throw exactError;
  if (exact) {
    await linkExternalSource(supabase, userId, exact.id as string, source);
    return { transaction: decode(exact), duplicate: true, duplicateKind: "exact" as const };
  }

  assertToolAllowed("finance", "finance.find_similar_transactions");
  const dates = nearbyDates(candidate.occurredOn);
  const { data: nearby, error: nearbyError } = await supabase
    .from("finance_transactions")
    .select("id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, category, note_ciphertext")
    .eq("user_id", userId)
    .eq("amount_minor", candidate.amountMinor)
    .eq("currency", currency)
    .eq("direction", candidate.direction)
    .gte("occurred_on", dates.from)
    .lte("occurred_on", dates.to)
    .limit(20);
  if (nearbyError) throw nearbyError;
  const merchant = normalizeMerchant(candidate.merchant);
  const probable = (nearby ?? []).find((row) => normalizeMerchant(decryptText(row.merchant_ciphertext as string)) === merchant);
  if (probable) {
    await linkExternalSource(supabase, userId, probable.id as string, source);
    return { transaction: decode(probable), duplicate: true, duplicateKind: "probable" as const };
  }

  const { data: inserted, error: insertError } = await supabase.from("finance_transactions").insert({
    user_id: userId,
    occurred_on: candidate.occurredOn,
    amount_minor: candidate.amountMinor,
    currency,
    direction: candidate.direction,
    merchant_ciphertext: encryptText(candidate.merchant),
    merchant_hash: piiHmac(merchant),
    category: candidate.category,
    note_ciphertext: candidate.note ? encryptText(candidate.note) : null,
    dedupe_fingerprint: dedupeFingerprint,
  }).select("id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, category, note_ciphertext").single();
  if (insertError) {
    if (insertError.code === "23505") {
      return createTransactionCandidate(userId, candidate, source);
    }
    throw insertError;
  }

  assertToolAllowed("finance", "finance.link_sources");
  const { error: sourceError } = await supabase.from("finance_transaction_sources").insert({
    user_id: userId,
    transaction_id: inserted.id,
    source_type: source.type,
    external_ref_hmac: source.externalRef ? piiHmac(source.externalRef) : null,
    payload_ciphertext: source.payload ? encryptText(source.payload) : null,
  });
  if (sourceError) throw sourceError;
  return { transaction: decode(inserted), duplicate: false, duplicateKind: null };
}

export async function listTransactions(userId: string, from: string, to: string) {
  assertToolAllowed("finance", "finance.aggregate");
  const { data, error } = await createAdminClient()
    .from("finance_transactions")
    .select("id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, category, note_ciphertext")
    .eq("user_id", userId)
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .order("occurred_on", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map(decode);
}

function decode(row: Record<string, unknown>): StoredTransaction {
  return {
    id: row.id as string,
    occurredOn: row.occurred_on as string,
    amountMinor: Number(row.amount_minor),
    currency: row.currency as string,
    direction: row.direction as "expense" | "income",
    merchant: decryptText(row.merchant_ciphertext as string),
    category: row.category as string,
    note: row.note_ciphertext ? decryptText(row.note_ciphertext as string) : null,
  };
}

async function linkExternalSource(supabase: ReturnType<typeof createAdminClient>, userId: string, transactionId: string, source: TransactionSource) {
  if (!source.externalRef) return;
  const { error } = await supabase.from("finance_transaction_sources").insert({
    user_id: userId,
    transaction_id: transactionId,
    source_type: source.type,
    external_ref_hmac: piiHmac(source.externalRef),
    payload_ciphertext: source.payload ? encryptText(source.payload) : null,
  });
  if (error && error.code !== "23505") throw error;
}
