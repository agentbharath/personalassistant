import { z } from "zod";
import { callClaude } from "@/lib/runtime/model-runtime";
import { searchGmailForImport, newGmailImportCursor, type GmailImportCursor } from "@/lib/tools/email/google-gmail";
import { acquireEmailScan, saveEmailScan, cancelEmailScan, type ScanHandle } from "@/lib/workflows/email-scan";
import { IMPORT_BUDGET } from "@/lib/runtime/import-budget";
import { extendRequestBudget } from "@/lib/runtime/request-context";
import { reportFailure } from "@/lib/observability/report";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Step 1 of a real historical backfill (R32, 2026-09-26): "which senders matter" is a question worth answering ONCE, cheaply, and having
 * the owner actually look at — reading every email's body and classifying it individually, cold, is both the most expensive way to do this
 * and the least reliable, since a model reading one snippet at a time has no way to notice "this sender never once sent anything financial
 * in five years." Listing is metadata-only (Gmail's own `format=metadata`, no bodies) and reuses the exact resumable, leased, checkpointed
 * cursor the bulk email-finance import already proves works at real scale — not a second copy of that machinery.
 */
export const WORKFLOW = "sender_inventory";

export type SenderStat = { domain: string; count: number; subjects: string[]; lastSeen: string };
export type SenderClassification = "transactional" | "mixed" | "none";
export type ClassifiedSender = SenderStat & { classification: SenderClassification };
export type SenderInventoryData = { since: string; cursor: GmailImportCursor; senders: Record<string, SenderStat>; scannedCount: number };

/** Read-only: a bare "continue" needs to know whether there's actually a scan to resume before deciding whether a missing "since" date
 * is real doubt worth asking about, without claiming the scan's lease just to check. */
export async function hasSenderInventoryInProgress(userId: string, conversationId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("workflow_checkpoints").select("id")
    .eq("user_id", userId).eq("conversation_id", conversationId).eq("workflow_type", WORKFLOW).in("state", ["running", "paused", "stop_requested"]).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function domainOf(from: string): string {
  const match = from.match(/@([^>\s]+)/);
  return match ? match[1].toLowerCase() : from.trim().toLowerCase() || "(unknown sender)";
}

/** One call, however large the mailbox: this only ever advances as far as its budget allows, and is safe to call again — it resumes
 * exactly where the last call left off, the same "continue scan" shape the bulk import already uses. */
export async function advanceSenderInventory(userId: string, conversationId: string, sinceIso: string): Promise<{ done: boolean; senders: SenderStat[]; scannedCount: number }> {
  // The chat route's default request deadline is 20 seconds — fine for an ordinary reply, fatal for a mailbox scan. Extending here,
  // the same way the bulk import already does (found live, R32: without this the request was always killed by the OUTER 20-second
  // timer before this function's own internal deadline below ever had a chance to stop cleanly and save a checkpoint).
  extendRequestBudget(IMPORT_BUDGET.totalMs, IMPORT_BUDGET.costLimitUsd);
  const startedAt = Date.now();
  const query = `after:${Math.floor(Date.parse(sinceIso) / 1000)} -in:spam -in:trash`;
  let handle: ScanHandle<SenderInventoryData> | null = await acquireEmailScan<SenderInventoryData>(userId, conversationId, undefined, WORKFLOW);
  if (!handle) handle = await acquireEmailScan<SenderInventoryData>(userId, conversationId, { since: sinceIso, cursor: newGmailImportCursor(query), senders: {}, scannedCount: 0 }, WORKFLOW);
  if (!handle) throw new Error("SENDER_INVENTORY_UNAVAILABLE");
  const data = handle.data;
  const persist = () => saveEmailScan(handle!, "running", WORKFLOW);
  const deadlineAt = startedAt + IMPORT_BUDGET.searchMs - IMPORT_BUDGET.finishReserveMs;
  const result = await searchGmailForImport(userId, query, 50_000, deadlineAt, { cursor: data.cursor, onProgress: persist });
  // Drain what this call found into sender stats, then clear the cursor's own buffer — resumability lives in `pending`/`seen`/`stage`
  // below, not in `ready`, so this is safe to do every call without losing the scan's place.
  for (const message of data.cursor.ready) {
    const domain = domainOf(message.from);
    const stat = data.senders[domain] ?? { domain, count: 0, subjects: [], lastSeen: message.date };
    stat.count += 1;
    if (stat.subjects.length < 5 && !stat.subjects.includes(message.subject)) stat.subjects.push(message.subject);
    if (!stat.lastSeen || message.date > stat.lastSeen) stat.lastSeen = message.date;
    data.senders[domain] = stat;
  }
  data.scannedCount += data.cursor.ready.length;
  data.cursor.ready = [];
  const done = !result.truncated && data.cursor.pending.length === 0 && data.cursor.stage >= data.cursor.queries.length;
  await saveEmailScan(handle, done ? "completed" : "paused", WORKFLOW);
  if (done) await cancelEmailScan(userId, conversationId, WORKFLOW).catch(() => undefined);
  return { done, senders: Object.values(data.senders).sort((a, b) => b.count - a.count), scannedCount: data.scannedCount };
}

const classifySchema = z.object({ senders: z.array(z.object({ domain: z.string(), classification: z.enum(["transactional", "mixed", "none"]) })) });
const CLASSIFY_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["senders"],
  properties: { senders: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["domain", "classification"],
    properties: { domain: { type: "string" }, classification: { type: "string", enum: ["transactional", "mixed", "none"] } },
  } } },
} as const;

/** Classifies senders, not emails: a handful of subject lines per domain is enough to tell "your bank" from "a newsletter you get from
 * the same store," at a fraction of reading every email's body cold. Batched (20 senders/call) since there can be a few hundred. */
export async function classifySenders(senders: SenderStat[], userId: string): Promise<ClassifiedSender[]> {
  const results: ClassifiedSender[] = [];
  for (let offset = 0; offset < senders.length; offset += 20) {
    const batch = senders.slice(offset, offset + 20);
    try {
      const response = await callClaude("sender_classification", {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        temperature: 0,
        system: `Classify each email sender domain by whether it sends messages about real money moving: purchases, bills, payments, transfers, refunds, statements, receipts. transactional: every sample looks financial (a bank, a card issuer, a utility, a store's own receipt address). mixed: some samples are financial and some aren't (a store that sends both receipts and marketing from the same address). none: newsletters, social notifications, work tools, recruiters, personal contacts — nothing about the person's own money. Judge from the subject lines given, not the domain name alone. Return one entry per domain given, in the same order. Return JSON only.`,
        messages: [{ role: "user", content: JSON.stringify(batch.map((sender) => ({ domain: sender.domain, sampleSubjects: sender.subjects }))) }],
        output_config: { format: { type: "json_schema", schema: CLASSIFY_JSON_SCHEMA } },
      }, { userId });
      const block = response.content.find((item) => item.type === "text");
      if (!block || block.type !== "text") throw new Error("SENDER_CLASSIFICATION_MISSING");
      const parsed = classifySchema.parse(JSON.parse(block.text));
      const byDomain = new Map(parsed.senders.map((item) => [item.domain, item.classification]));
      for (const sender of batch) results.push({ ...sender, classification: byDomain.get(sender.domain) ?? "none" });
    } catch (error) {
      // A malformed or failed batch degrades to "none" rather than crashing the whole inventory (found live, R32) — worse for recall on
      // this one batch, never worse for safety, and the sender list still shows these domains for the owner to correct by hand.
      reportFailure("sender_classification_failed", error);
      for (const sender of batch) results.push({ ...sender, classification: "none" });
    }
  }
  return results;
}

/** Code renders the review list; the model only classified. Grouped by classification so "yes, PG&E; no, LinkedIn" is a fast scan. */
export function renderSenderInventory(senders: ClassifiedSender[], done: boolean, scannedCount: number): string {
  const groups: Record<SenderClassification, ClassifiedSender[]> = { transactional: [], mixed: [], none: [] };
  for (const sender of senders) groups[sender.classification].push(sender);
  const line = (sender: ClassifiedSender) => `- **${sender.domain}** (${sender.count}) — e.g. "${sender.subjects[0] ?? ""}"`;
  const section = (label: string, list: ClassifiedSender[]) => (list.length ? `**${label}** (${list.length})\n${list.map(line).join("\n")}` : "");
  const sections = [
    section("Transactional", groups.transactional),
    section("Mixed", groups.mixed),
    section("Not financial", groups.none),
  ].filter(Boolean);
  const header = done
    ? `Scanned ${scannedCount} emails, ${senders.length} distinct senders.`
    : `Scanned ${scannedCount} emails so far, ${senders.length} distinct senders — still going. Say "continue" to keep scanning.`;
  return `${header}\n\n${sections.join("\n\n")}\n\nSay which ones to fix — "LinkedIn is not financial" or "add Chase as transactional" — then "import from these senders" to run the actual backfill on transactional and mixed senders only.`;
}
