import { assertToolAllowed } from "@/lib/agents/registry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * When bills were last checked against email for this user. R17.8 no longer re-scans email on every "what do I owe": a full sweep runs at
 * most every `BILLS_EMAIL_RECHECK_MS`, and a plain listing in between answers from the saved bills alone. Uses the `finance_sync_state`
 * table (migration 0024); only `synced_through` is touched here, the rest of that table's columns are for a later, fuller sync.
 */
export const BILLS_EMAIL_RECHECK_MS = 6 * 60 * 60 * 1000;

export async function lastBillsEmailCheck(userId: string): Promise<Date | null> {
  assertToolAllowed("finance", "finance.sync_state");
  const { data, error } = await createAdminClient().from("finance_sync_state").select("synced_through").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.synced_through ? new Date(data.synced_through) : null;
}

export async function recordBillsEmailCheck(userId: string, when: Date) {
  assertToolAllowed("finance", "finance.sync_state");
  const { error } = await createAdminClient().from("finance_sync_state").upsert({ user_id: userId, synced_through: when.toISOString(), updated_at: when.toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

/** Whether enough time has passed since the last check to justify another live sweep of email. */
export function dueForBillsEmailCheck(lastChecked: Date | null, now: Date, intervalMs = BILLS_EMAIL_RECHECK_MS) {
  return !lastChecked || now.getTime() - lastChecked.getTime() >= intervalMs;
}
