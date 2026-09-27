import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";

const WORKFLOW = "email_finance_scan";
const LEASE_MS = 300_000;
const TTL_MS = 7 * 24 * 60 * 60_000;
export class ScanBusyError extends Error {}
export class ScanStoppedError extends Error {}
export type ScanHandle<T> = { id: string; version: number; userId: string; conversationId: string; data: T; expectedState?: string; stopped?: boolean };

/** One encrypted scan per conversation. A versioned lease prevents two tabs advancing it together. `workflowType` lets an unrelated
 * long-running scan (the sender inventory, R32) share this exact resumable/leased checkpoint mechanism under its own row, instead of a
 * second copy of this concurrency-control code. */
export async function acquireEmailScan<T>(userId: string, conversationId: string, initial?: T, workflowType = WORKFLOW): Promise<ScanHandle<T> | null> {
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("workflow_checkpoints").select("id,version,state,checkpoint,updated_at")
    .eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", workflowType).maybeSingle();
  if (error) throw error;
  if (!row) {
    if (!initial) return null;
    const { data, error: insertError } = await admin.from("workflow_checkpoints").insert({ user_id: userId, conversation_id: conversationId, request_id: `${workflowType}:${conversationId}`, workflow_type: workflowType, state: "running", checkpoint: { payloadCiphertext: encryptText(JSON.stringify(initial)) } }).select("id,version").single();
    if (insertError?.code === "23505") throw new ScanBusyError();
    if (insertError) throw insertError;
    return { ...data, userId, conversationId, data: initial } as ScanHandle<T>;
  }
  const age = Date.now() - Date.parse(row.updated_at);
  if (["running", "stop_requested"].includes(row.state) && age < LEASE_MS) throw new ScanBusyError();
  if (!initial && (row.state === "cancelled" || age > TTL_MS)) return null;
  const data = initial ?? JSON.parse(decryptText((row.checkpoint as { payloadCiphertext: string }).payloadCiphertext)) as T;
  const handle = { id: row.id as string, version: row.version as number, userId, conversationId, data, expectedState: row.state as string };
  await saveEmailScan(handle, "running", workflowType);
  return handle;
}

export async function saveEmailScan<T>(handle: ScanHandle<T>, state: "running" | "paused" | "completed" = "running", workflowType = WORKFLOW) {
  // Retry transient checkpoint transport failures. The exact ciphertext also identifies
  // a write that committed even if its HTTP response was lost; never replay a newer writer.
  if (handle.stopped) return;
  const checkpoint = { payloadCiphertext: encryptText(JSON.stringify(handle.data)) };
  for (let attempt = 0; ; attempt++) {
    let query = createAdminClient().from("workflow_checkpoints").update({ state, version: handle.version + 1, updated_at: new Date().toISOString(), checkpoint })
      .eq("id", handle.id).eq("user_id", handle.userId).eq("conversation_id", handle.conversationId).eq("version", handle.version);
    query = query.eq("state", handle.expectedState ?? "running");
    const { data, error } = await query.select("id").maybeSingle();
    if (!error && data) break;
    if (!error && !data && attempt > 0) {
      const { data: saved, error: readError } = await createAdminClient().from("workflow_checkpoints").select("version,checkpoint")
        .eq("id", handle.id).eq("user_id", handle.userId).eq("conversation_id", handle.conversationId).maybeSingle();
      if (!readError && saved?.version === handle.version + 1 && saved.checkpoint?.payloadCiphertext === checkpoint.payloadCiphertext) break;
    }
    if (!error) {
      const { data: stopped, error: stopError } = await createAdminClient().from("workflow_checkpoints").select("state,version")
        .eq("id", handle.id).eq("user_id", handle.userId).eq("conversation_id", handle.conversationId).maybeSingle();
      if (!stopError && stopped?.state === "stop_requested" && stopped.version === handle.version) {
        handle.expectedState = "stop_requested";
        await saveEmailScan(handle, "paused", workflowType);
        handle.stopped = true;
        throw new ScanStoppedError();
      }
      throw new ScanBusyError();
    }
    const transient = error.code === "" || error.name === "TypeError" || ["08000", "08006", "57P01"].includes(error.code);
    if (!transient || attempt >= 2) throw error;
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  handle.version += 1;
  handle.expectedState = state;
}

export async function cancelEmailScan(userId: string, conversationId: string, workflowType = WORKFLOW) {
  const { data, error } = await createAdminClient().from("workflow_checkpoints").update({ state: "cancelled", updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", workflowType).in("state", ["paused", "completed"]).select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

/** Keep the continuation control available after confirming only the records found so far. */
export async function emailScanContinuationNote(userId: string, conversationId: string, workflowType = WORKFLOW) {
  const { data, error } = await createAdminClient().from("workflow_checkpoints").select("id,updated_at")
    .eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", workflowType).eq("state", "paused").maybeSingle();
  if (error) throw error;
  return data && Date.now() - Date.parse(data.updated_at) <= TTL_MS
    ? "\n\nYour email scan still has unfinished work. Choose **Continue scan** to check the remaining emails. Saved transactions will not be imported twice."
    : "";
}

/** Cooperative stop: the active writer saves its in-flight batch before releasing the lease. */
export async function requestEmailScanStop(userId: string, conversationId: string, workflowType = WORKFLOW) {
  const { error } = await createAdminClient().from("workflow_checkpoints").update({ state: "stop_requested" })
    .eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", workflowType).eq("state", "running").select("id");
  if (error) throw error;
}
