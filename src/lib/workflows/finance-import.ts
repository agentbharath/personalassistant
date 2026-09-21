import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { createBill, settleBill } from "@/lib/tools/finance/bills";
import { createTransactionCandidate, type TransactionCandidate } from "@/lib/tools/finance/transactions";

type PendingImport = {
  candidate: TransactionCandidate;
  source: { type: "email" | "receipt"; externalRef: string; payload: string };
  /** R17: a bill is stored as a bill; a payment settles a bill; anything else is an expense. */
  kind?: "bill" | "payment";
  billId?: string;
  dueOn?: string | null;
};

type Outcome = { kind: "expense" | "bill" | "paid"; /** A card payment: recorded, but not spending. */ transfer?: boolean; duplicate: boolean; merchant: string; amountMinor: number; currency: string; date: string; dueOn?: string | null };

async function applyItem(userId: string, item: PendingImport): Promise<Outcome> {
  const { candidate, source } = item;
  const base = { merchant: candidate.merchant, amountMinor: candidate.amountMinor, currency: candidate.currency, date: candidate.occurredOn };
  if (item.kind === "bill") {
    const result = await createBill(userId, { merchant: candidate.merchant, amountMinor: candidate.amountMinor, currency: candidate.currency, category: candidate.category, statementDate: candidate.occurredOn, dueDate: item.dueOn ?? null }, { externalRef: source.externalRef, payload: source.payload });
    return { ...base, kind: "bill", duplicate: result.duplicate, dueOn: result.bill.dueDate };
  }
  if (item.kind === "payment" && item.billId) {
    const result = await settleBill(userId, item.billId, candidate.occurredOn, { type: source.type, externalRef: source.externalRef, payload: source.payload }, candidate.direction === "transfer" ? "transfer" : "expense");
    return { ...base, kind: "paid", transfer: candidate.direction === "transfer", duplicate: result.duplicate };
  }
  const result = await createTransactionCandidate(userId, candidate, { type: source.type, externalRef: source.externalRef, payload: source.payload });
  return { ...base, kind: "expense", transfer: candidate.direction === "transfer", duplicate: result.duplicate };
}

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

function describeOutcome(outcome: Outcome) {
  const amount = `**${outcome.merchant} — ${formatMoney(outcome.amountMinor, outcome.currency)}**`;
  if (outcome.kind === "bill") return outcome.duplicate ? `${amount} was already recorded as a bill.` : `Recorded ${amount} as a bill${outcome.dueOn ? `, due ${day(outcome.dueOn)}` : ""}. It isn't counted as spending until it's paid.`;
  if (outcome.kind === "paid") return outcome.duplicate ? `${amount} was already marked paid.` : `Marked the ${outcome.merchant} bill paid: ${formatMoney(outcome.amountMinor, outcome.currency)} on ${day(outcome.date)}. It now counts as spending.`;
  if (outcome.transfer) return outcome.duplicate ? `I didn’t add another copy. ${amount} is already recorded as a card payment.` : `Recorded ${amount} as a **card payment**. It isn't counted as spending, because the purchases on the card are.`;
  return outcome.duplicate ? `I didn’t add another copy. ${amount} is already recorded.` : `Imported ${amount} from the approved email.`;
}

type PendingImportBatch = { items: PendingImport[] };

export async function createFinanceImportApproval(userId: string, conversationId: string, pending: PendingImport | PendingImportBatch) {
  const admin = createAdminClient();
  // A new preview replaces any older one in this conversation ("actually, only the second one"), so Confirm can only mean the latest.
  const { data: older } = await admin.from("workflow_checkpoints").select("id").eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", "email_finance_import").eq("state", "pending_approval");
  if (older?.length) {
    const ids = older.map((row) => row.id as string);
    await admin.from("approvals").update({ status: "expired" }).in("workflow_checkpoint_id", ids).eq("status", "pending");
    await admin.from("workflow_checkpoints").update({ state: "superseded", updated_at: new Date().toISOString() }).in("id", ids);
  }
  const requestId = randomUUID();
  const payloadCiphertext = encryptText(JSON.stringify(pending));
  const { data: checkpoint, error: checkpointError } = await admin.from("workflow_checkpoints").insert({
    user_id: userId,
    conversation_id: conversationId,
    request_id: requestId,
    workflow_type: "email_finance_import",
    state: "pending_approval",
    checkpoint: { payloadCiphertext, validationVersion: 2 },
  }).select("id").single();
  if (checkpointError) throw checkpointError;
  const { error: approvalError } = await admin.from("approvals").insert({
    user_id: userId,
    workflow_checkpoint_id: checkpoint.id,
    preview_hash: piiHmac(payloadCiphertext),
    status: "pending",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (approvalError) throw approvalError;
}

export async function resolvePendingFinanceImport(userId: string, conversationId: string, input: string) {
  const decision = approvalDecision(input);
  if (!decision) return null;
  const admin = createAdminClient();
  const { data: checkpoints, error } = await admin.from("workflow_checkpoints")
    .select("id, checkpoint")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("workflow_type", "email_finance_import")
    .eq("state", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const checkpoint = checkpoints?.[0];
  if (!checkpoint) return null;
  const checkpointData = checkpoint.checkpoint as { payloadCiphertext?: string; validationVersion?: number };
  const { data: approval, error: approvalError } = await admin.from("approvals")
    .select("id, expires_at")
    .eq("workflow_checkpoint_id", checkpoint.id)
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (approvalError) throw approvalError;
  if (!approval) return null;
  if (checkpointData.validationVersion !== 2) {
    await Promise.all([
      admin.from("approvals").update({ status: "expired" }).eq("id", approval.id).eq("status", "pending"),
      admin.from("workflow_checkpoints").update({ state: "superseded", updated_at: new Date().toISOString() }).eq("id", checkpoint.id),
    ]);
    return { answer: "That preview used an older validation rule and can’t be imported. Ask me to find the statement again.", status: "waiting_for_user" as const };
  }
  if (new Date(approval.expires_at as string).getTime() <= Date.now()) {
    await Promise.all([
      admin.from("approvals").update({ status: "expired" }).eq("id", approval.id).eq("status", "pending"),
      admin.from("workflow_checkpoints").update({ state: "expired", updated_at: new Date().toISOString() }).eq("id", checkpoint.id),
    ]);
    return { answer: "That import preview expired. Ask me to find the email again and I’ll create a fresh preview.", status: "waiting_for_user" as const };
  }
  if (decision === "deny") {
    await Promise.all([
      admin.from("approvals").update({ status: "denied" }).eq("id", approval.id).eq("status", "pending"),
      admin.from("workflow_checkpoints").update({ state: "cancelled", updated_at: new Date().toISOString() }).eq("id", checkpoint.id),
    ]);
    return { answer: "Import cancelled. Nothing was added to your finances.", status: "completed" as const };
  }
  const encrypted = checkpointData.payloadCiphertext;
  if (!encrypted) throw new Error("FINANCE_IMPORT_CHECKPOINT_INVALID");
  const pending = JSON.parse(decryptText(encrypted)) as PendingImport | PendingImportBatch;
  const items = "items" in pending ? pending.items : [pending];
  const { data: claimed, error: claimError } = await admin.from("approvals")
    .update({ status: "approved" })
    .eq("id", approval.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { answer: "That import was already resolved. Nothing was added twice.", status: "completed" as const };
  try {
    const results: Outcome[] = [];
    for (const item of items) results.push(await applyItem(userId, item));
    await Promise.all([
      admin.from("approvals").update({ status: "consumed", consumed_at: new Date().toISOString() }).eq("id", approval.id),
      admin.from("workflow_checkpoints").update({ state: "completed", updated_at: new Date().toISOString() }).eq("id", checkpoint.id),
    ]);
    if (results.length === 1) return { answer: describeOutcome(results[0]), status: "completed" as const };
    const added = results.filter((result) => !result.duplicate);
    const skipped = results.length - added.length;
    return {
      answer: `Saved ${added.length} of ${results.length} items${skipped ? ` (${skipped} already recorded, so not added again)` : ""}.\n\n${results.map((result) => `- ${describeOutcome(result)}`).join("\n")}`,
      status: "completed" as const,
    };
  } catch (importError) {
    await admin.from("workflow_checkpoints").update({ state: "failed", updated_at: new Date().toISOString() }).eq("id", checkpoint.id);
    throw importError;
  }
}

function approvalDecision(input: string) {
  const normalized = input.trim().toLowerCase();
  if (/^(confirm|confirmed|approve|approved|yes|yes,? import|import it|looks good|go ahead)[.!]?$/.test(normalized)) return "approve" as const;
  if (/^(cancel|deny|no|nope|don['’]?t import|stop)[.!]?$/.test(normalized)) return "deny" as const;
  return null;
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}
