import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { newGmailImportCursor, type GmailImportCursor, type EmailSearchResult } from "@/lib/tools/email/google-gmail";
import type { PendingImport } from "@/lib/workflows/finance-import";
import type { MailClass } from "./classifier";
export type SyncCursor = {gmail: GmailImportCursor; classes: Record<string, MailClass>};
export type SyncState = {user_id: string; run_id: string; conversation_id: string | null; status: "idle" | "queued" | "running" | "review" | "blocked"; synced_through: string | null; covered_from: string | null; scan_from: string; scan_through: string; cursor_ciphertext: string; checked: number; version: number; lease_id: string | null; lease_until: string | null; last_error: string | null};
export type SyncCandidate = {id: string; source_ref_hmac: string; status: string; classification: string; payload_ciphertext: string | null};
export const enabled = () => process.env.FINANCE_SYNC_ENABLED === "true";
export async function loadSync(userId: string): Promise<SyncState | null> {
 const {data, error} = await createAdminClient().from("finance_sync_state").select("*").eq("user_id", userId).maybeSingle();
 if (error) throw error;
 return data as SyncState | null;
}
export async function queueSync(userId: string, conversationId?: string, backfill: boolean | "all" = false, now = Date.now()) {
 const old = await loadSync(userId);
 if (old && old.status !== "idle") return old;
 const until = new Date(Math.floor(now / 1000) * 1000).toISOString();
 const since = backfill === "all" || !old?.synced_through && !backfill ? 0 : backfill ? Math.min(now - 90 * 86400000, old?.synced_through ? Date.parse(old.synced_through) - 86400000 : now) : old?.synced_through ? Date.parse(old.synced_through) - 86400000 : now - 7 * 86400000;
 // A one-day overlap catches late-arriving mail. The source ledger makes overlap idempotent.
 const from = new Date(Math.floor(since / 1000) * 1000).toISOString();
 const query = `${since > 0 ? `after:${Math.floor(since / 1000) - 1} ` : ""}before:${Math.floor(now / 1000)} -in:spam -in:trash`;
 const cursor: SyncCursor = {gmail: newGmailImportCursor(query), classes: {}};
 const patch = {user_id: userId, run_id: randomUUID(), conversation_id: conversationId ?? old?.conversation_id ?? null, status: "queued", scan_from: from, scan_through: until, cursor_ciphertext: encryptText(JSON.stringify(cursor)), checked: 0, last_error: null, lease_id: null, lease_until: null, version: (old?.version ?? 0) + 1, updated_at: new Date().toISOString()};
 const admin = createAdminClient();
 const result = old ? await admin.from("finance_sync_state").update(patch).eq("user_id", userId).eq("version", old.version).eq("status", "idle").select("*").maybeSingle() : await admin.from("finance_sync_state").insert(patch).select("*").single();
 if (result.error?.code === "23505") return (await loadSync(userId))!;
 if (result.error) throw result.error;
 return (result.data as SyncState | null) ?? (await loadSync(userId))!;
}
export async function claimSync(state: SyncState) {
 if (!["queued", "running"].includes(state.status) || (state.lease_until && Date.parse(state.lease_until) > Date.now())) return null;
 const lease = randomUUID();
 const {data, error} = await createAdminClient().from("finance_sync_state").update({status: "running", lease_id: lease, lease_until: new Date(Date.now() + 300_000).toISOString(), version: state.version + 1}).eq("user_id", state.user_id).eq("version", state.version).select("*").maybeSingle();
 if (error) throw error;
 return data as SyncState | null;
}
export const decodeCursor = (state: SyncState) => {
 const cursor = JSON.parse(decryptText(state.cursor_ciphertext)) as SyncCursor;
 // Full-history cursors have no lower Gmail date bound, including ones queued during rollout.
 if (Date.parse(state.scan_from) === 0) cursor.gmail.queries = cursor.gmail.queries.map(query => query.replace(/^after:-1 /, ""));
 return cursor;
};
export const decodeCandidate = (row: SyncCandidate) => row.payload_ciphertext ? JSON.parse(decryptText(row.payload_ciphertext)) as PendingImport : null;
export async function saveSync(state: SyncState, cursor: SyncCursor, status: SyncState["status"] = "running", errorCode: string | null = null) {
 const {data, error} = await createAdminClient().from("finance_sync_state").update({status, cursor_ciphertext: encryptText(JSON.stringify(cursor)), checked: cursor.gmail.checked, last_error: errorCode, ...(status !== "running" ? {lease_id: null, lease_until: null} : {}), updated_at: new Date().toISOString()}).eq("user_id", state.user_id).eq("run_id", state.run_id).eq("lease_id", state.lease_id).select("user_id").maybeSingle();
 if (error) throw error;
 if (!data) throw new Error("SYNC_LEASE_LOST");
}
export async function candidates(userId: string, runId: string, statuses = ["pending", "blocked"]): Promise<SyncCandidate[]> {
 const all: SyncCandidate[] = [];
 for (let offset = 0; ; offset += 200) {
 const {data, error} = await createAdminClient().from("finance_import_candidates").select("id,source_ref_hmac,status,classification,payload_ciphertext").eq("user_id", userId).eq("run_id", runId).in("status", statuses).order("created_at").order("id").range(offset, offset + 199);
 if (error) throw error;
 all.push(...(data ?? []) as SyncCandidate[]);
 if (!data || data.length < 200) return all;
 }
}
export async function knownCandidateRefs(userId: string, ids: string[]) {
 if (!ids.length) return new Set<string>();
 const hashed = new Map(ids.map(id => [piiHmac(id), id]));
 const admin = createAdminClient();
 const results = await Promise.all([
   admin.from("finance_import_candidates").select("source_ref_hmac").eq("user_id", userId).neq("status", "blocked").in("source_ref_hmac", [...hashed.keys()]),
   admin.from("finance_bills").select("source_ref_hmac").eq("user_id", userId).in("source_ref_hmac", [...hashed.keys()]),
 ]);
 for (const result of results) if (result.error) throw result.error;
 return new Set(results.flatMap(result => (result.data ?? []).map(row => hashed.get(row.source_ref_hmac)!)).filter(Boolean));
}
export async function stageCandidate(state: SyncState, id: string, classification: MailClass, item: PendingImport | null, status = item ? "pending" : "ignored", retryMail?: EmailSearchResult) {
 const row = {user_id: state.user_id, run_id: state.run_id, source_ref_hmac: piiHmac(id), classification, status, payload_ciphertext: item || retryMail ? encryptText(JSON.stringify(item ?? {retryMail})) : null};
 const admin = createAdminClient();
 const {error} = await admin.from("finance_import_candidates").insert(row);
 if (error?.code === "23505") {
   const {error: updated} = await admin.from("finance_import_candidates").update(row).eq("user_id", state.user_id).eq("source_ref_hmac", row.source_ref_hmac).eq("status", "blocked");
   if (updated) throw updated;
 } else if (error) throw error;
}
export async function retrySync(userId: string) {
 const state = await loadSync(userId);
 if (!state || state.status !== "blocked") return state;
 const cursor = decodeCursor(state);
 for (const row of await candidates(userId, state.run_id, ["blocked"])) {
   const payload = row.payload_ciphertext ? JSON.parse(decryptText(row.payload_ciphertext)) as {retryMail?: EmailSearchResult} : null;
   if (payload?.retryMail && !cursor.gmail.ready.some(m => m.id === payload.retryMail!.id)) cursor.gmail.ready.push(payload.retryMail);
 }
 const {error} = await createAdminClient().from("finance_sync_state").update({status: "queued", last_error: null, cursor_ciphertext: encryptText(JSON.stringify(cursor)), version: state.version + 1}).eq("user_id", userId).eq("version", state.version).eq("status", "blocked");
 if (error) throw error;
 return loadSync(userId);
}
export async function settleSyncCandidates(userId: string, runId: string, ids: string[], status: "approved" | "rejected") {
 if (!ids.length) return;
 const {error} = await createAdminClient().from("finance_import_candidates").update({status}).eq("user_id", userId).eq("run_id", runId).in("id", ids).eq("status", "pending");
 if (error) throw error;
 await finishSync(userId, runId);
}
export async function finishSync(userId: string, runId: string) {
 const state = await loadSync(userId);
 if (!state || state.run_id !== runId || state.status !== "review") return;
 if ((await candidates(userId, runId)).length) return;
 // Only a complete scan with every candidate resolved can move the coverage watermark.
 const {error} = await createAdminClient().from("finance_sync_state").update({status: "idle", synced_through: state.synced_through && state.synced_through > state.scan_through ? state.synced_through : state.scan_through, covered_from: state.covered_from && state.covered_from < state.scan_from ? state.covered_from : state.scan_from, updated_at: new Date().toISOString()}).eq("user_id", userId).eq("run_id", runId).eq("status", "review");
 if (error) throw error;
}
export function freshnessLabel(state: SyncState | null) {
 return state?.synced_through ? `Based on saved transactions; email reviewed through ${state.synced_through.slice(0, 10)}${state.covered_from ? ` (coverage starts ${state.covered_from.slice(0, 10)})` : ""}.` : "Based on saved transactions. Email sync has not completed yet.";
}
export function blockedDetails(row: SyncCandidate) {
 const value = row.payload_ciphertext ? JSON.parse(decryptText(row.payload_ciphertext)) as {retryMail?: EmailSearchResult} : null;
 return {id: row.id, subject: value?.retryMail?.subject ?? "Unreadable financial email", messageId: value?.retryMail?.id};
}
export async function excludeBlocked(userId: string, ids: string[]) {
 const state = await loadSync(userId);
 if (!state || state.status !== "blocked" || !ids.length) return;
 const admin = createAdminClient();
 const {error} = await admin.from("finance_import_candidates").update({status: "rejected"}).eq("user_id", userId).eq("run_id", state.run_id).eq("status", "blocked").in("id", ids);
 if (error) throw error;
 if (!(await candidates(userId, state.run_id, ["blocked"])).length) {
   const cursor = decodeCursor(state);
   const more = cursor.gmail.stage < cursor.gmail.queries.length || cursor.gmail.ready.length || cursor.gmail.pending.length;
   const {error: updated} = await admin.from("finance_sync_state").update({status: more ? "queued" : "review", last_error: null, version: state.version + 1}).eq("user_id", userId).eq("version", state.version).eq("status", "blocked");
   if (updated) throw updated;
   await finishSync(userId, state.run_id);
 }
}
