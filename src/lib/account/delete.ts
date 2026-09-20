import { decryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

async function remove(table: string, userId: string) {
  const { error } = await createAdminClient().from(table).delete().eq("user_id", userId);
  if (error) throw new Error(`${table}: ${error.message}`);
}

/** Spending records only: expenses, income, bills and where they came from. Conversations and preferences are kept. */
export async function deleteSpendingData(userId: string) {
  // Bills point at the transaction that paid them and sources point at transactions, so those go first.
  await remove("finance_bills", userId);
  await remove("finance_transaction_sources", userId);
  await remove("finance_transactions", userId);
}

/** Tells Google to drop the saved permissions. Best effort: the account is deleted whether or not Google answers. */
async function revokeGoogleAccess(userId: string) {
  const { data } = await createAdminClient().from("oauth_connections").select("access_token_ciphertext, refresh_token_ciphertext").eq("user_id", userId);
  const tokens = new Set<string>();
  for (const row of data ?? []) {
    for (const value of [row.refresh_token_ciphertext, row.access_token_ciphertext]) {
      try { if (typeof value === "string") tokens.add(decryptText(value)); } catch { /* an unreadable token cannot be revoked */ }
    }
  }
  await Promise.all([...tokens].map((token) => fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined)));
}

/**
 * Deletes the account and everything stored for it. Order matters because most tables restrict deletion of what they point at:
 * approvals, then checkpoints, messages, conversations, spending, preferences, connections, telemetry, and last the sign-in account.
 */
export async function deleteAccount(userId: string) {
  await revokeGoogleAccess(userId);
  for (const table of ["approvals", "workflow_checkpoints", "message_feedback", "email_drafts", "conversation_messages", "conversations"]) await remove(table, userId);
  await deleteSpendingData(userId);
  for (const table of ["user_learnings", "oauth_connections", "query_runs", "model_usage_events", "model_usage_daily"]) await remove(table, userId);
  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  if (error) throw new Error(`account: ${error.message}`);
}
