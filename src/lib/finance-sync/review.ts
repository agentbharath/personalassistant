import { createFinanceImportApproval, type PendingImport } from "@/lib/workflows/finance-import";
import { previewDuplicate } from "@/lib/tools/finance/transactions";
import { saveEmailState } from "@/lib/conversations/email-state";
import { candidates, decodeCandidate, loadSync, enabled, freshnessLabel } from "./store";
import { hasPendingApproval } from "@/lib/workflows/pending";
const escape = (s: string) => s.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");
export async function prepareSyncReview(userId: string, conversationId: string) {
 if (await hasPendingApproval(userId, conversationId)) return "An approval is already waiting in this chat. Resolve it before reviewing the email sync.";
 const state = await loadSync(userId);
 if (!state || !["review", "blocked"].includes(state.status)) return "The email scan is still collecting records. Its progress is on Perch.";
 const rows = (await candidates(userId, state.run_id, ["pending"])).slice(0, 50);
 const items: PendingImport[] = rows.map(row => decodeCandidate(row)!);
 if (!items.length) return state.status === "blocked" ? "Some emails could not be extracted safely. Review the scan on Perch; the coverage date has not advanced." : "No new transactions need approval.";
 const descriptions: string[] = [];
 for (const [index, item] of items.entries()) {
   const duplicate = item.kind === "bill" ? null : await previewDuplicate(userId, item.candidate, item.source);
   const c = item.candidate;
   descriptions.push(`${index + 1}. **${escape(c.merchant)}** — ${new Intl.NumberFormat("en-US", {style: "currency", currency: c.currency}).format(c.amountMinor / 100)} · ${c.occurredOn}${item.kind === "bill" ? " · unpaid bill (not spending)" : item.kind === "payment" ? " · settles the matched saved bill" : c.direction === "income" ? " · refund/incoming funds" : c.direction === "transfer" ? " · transfer/card payment (not spending)" : ""}${duplicate ? ` · ${["probable", "exact"].includes(duplicate.duplicateKind) ? "proposed merge with" : "additional evidence for"} saved ${duplicate.transaction.occurredOn} transaction` : ""}`);
 }
 await createFinanceImportApproval(userId, conversationId, {items, sync: {runId: state.run_id, candidateIds: rows.map(row => row.id)}});
 await saveEmailState(userId, conversationId, {request: {action: "import_all", topic: "receipt", sender: null, days: null, calendar: null, unread: false, humansOnly: false, exclusion: ""}, results: items.map(item => {const meta = JSON.parse(item.source.payload); return {id: item.source.externalRef, subject: meta.subject, from: meta.from, date: meta.date};})});
 return `### Review ${items.length} new financial records\n\n${descriptions.join("\n")}\n\nChoose **Confirm** to save these records and the proposed merges, or **Cancel** to reject this batch. Nothing has been imported yet. This approval expires in 30 minutes. More than 50 candidates are reviewed in separate batches.`;
}
export async function financeFreshness(userId: string, conversationId?: string) {
 if (!enabled()) return {note: "", review: false};
 const state = await loadSync(userId);
 if (!state) return {note: freshnessLabel(null), review: false};
 return {note: `${freshnessLabel(state)}${state.status === "queued" || state.status === "running" ? " New emails are being checked in the background; progress is on Perch." : state.status === "blocked" ? ` ${state.last_error ?? "Some records need review on Perch."}` : state.status === "review" ? " New records await review on Perch." : ""}`, review: false};
}
