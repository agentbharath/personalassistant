import { ModelBudgetExceededError } from "@/lib/runtime/model-runtime";
import { reportFailure } from "@/lib/observability/report";
import { searchGmailForImport } from "@/lib/tools/email/google-gmail";
import { recordedEmailRefs } from "@/lib/tools/finance/transactions";
import { isUpiEmail } from "@/lib/agents/email-import-rules";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { classifyFinancialMail, isPositive, type MailClass } from "./classifier";
import { extractSyncCandidate } from "./extraction";
import { loadSync, claimSync, decodeCursor, saveSync, knownCandidateRefs, stageCandidate, candidates, finishSync } from "./store";
import { createAdminClient } from "@/lib/supabase/admin";
import { piiHmac } from "@/lib/security/pii-hmac";

/** Sender history is advisory. A marketing domain can also send a real receipt, so it is never a blanket exclusion. */
async function rememberSender(userId: string, from: string, positive: boolean) {
 const domain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
 if (!domain) return;
 const sender_hmac = piiHmac(domain);
 const admin = createAdminClient();
 const {data, error} = await admin.from("finance_sender_registry").select("positive_count,negative_count").eq("user_id", userId).eq("sender_hmac", sender_hmac).maybeSingle();
 if (error) throw error;
 const positive_count = (data?.positive_count ?? 0) + Number(positive);
 const negative_count = (data?.negative_count ?? 0) + Number(!positive);
 const status = positive_count >= 10 && negative_count === 0 ? "transactional" : negative_count >= 20 && positive_count === 0 ? "non_transactional" : "mixed";
 const {error: writeError} = await admin.from("finance_sender_registry").upsert({user_id: userId, sender_hmac, positive_count, negative_count, status, updated_at: new Date().toISOString()});
 if (writeError) throw writeError;
}
export async function advanceFinanceSync(userId: string, budgetMs = 45_000) {
 const existing = await loadSync(userId);
 if (!existing) return null;
 const state = await claimSync(existing);
 if (!state) return existing;
 const cursor = decodeCursor(state);
 const deadline = Date.now() + budgetMs;
 try {
   if (cursor.gmail.retryAt > Date.now()) { await saveSync(state, cursor, "queued"); return await loadSync(userId); }
   const persist = () => saveSync(state, cursor);
   if (!cursor.gmail.ready.length) await searchGmailForImport(userId, "", 50, Math.min(deadline - 15000, Date.now() + 15000), {cursor: cursor.gmail, onProgress: persist, skipKnown: async ids => {
     const [recorded, known] = await Promise.all([recordedEmailRefs(userId, ids), knownCandidateRefs(userId, ids)]);
     return new Set([...recorded, ...known]);
   }});
   const ready = cursor.gmail.ready;
   const [recorded, known] = await Promise.all([recordedEmailRefs(userId, ready.map(m => m.id)), knownCandidateRefs(userId, ready.map(m => m.id))]);
   cursor.gmail.ready = ready.filter(m => !recorded.has(m.id) && !known.has(m.id) && !isUpiEmail(m));
   const fresh = cursor.gmail.ready.filter(m => !cursor.classes[m.id]).slice(0, 20);
   Object.assign(cursor.classes, await classifyFinancialMail(userId, fresh));
   await persist();
   for (const mail of [...cursor.gmail.ready]) {
     if (Date.now() > deadline - 12000) break;
     const kind: MailClass | undefined = cursor.classes[mail.id];
     if (!kind) break;
     try {
       const item = isPositive(kind) ? await extractSyncCandidate(userId, mail.id, kind) : null;
       await stageCandidate(state, mail.id, kind, item);
       await rememberSender(userId, mail.from, isPositive(kind));
     } catch (error) {
       // Evidence failures need a visible manual decision. Provider/budget failures stay queued for retry.
       if (error instanceof Error && (error.name === "ZodError" || ["EXTRACTION_NEEDS_REVIEW", "STATEMENT_NEEDS_REVIEW", "REMITTANCE_NEEDS_REVIEW", "UNGROUNDED_ORDER", "INVALID_DATE"].includes(error.message))) {
         await stageCandidate(state, mail.id, kind, null, "blocked", mail);
       } else throw error;
     }
     cursor.gmail.ready = cursor.gmail.ready.filter(m => m.id !== mail.id);
     delete cursor.classes[mail.id];
     await persist();
   }
   const more = cursor.gmail.stage < cursor.gmail.queries.length || cursor.gmail.ready.length > 0 || cursor.gmail.pending.length > 0;
   const unresolved = more ? [] : await candidates(userId, state.run_id, ["blocked"]);
   await saveSync(state, cursor, more ? "queued" : unresolved.length ? "blocked" : "review", unresolved.length ? "Some records need manual review; watermark unchanged" : null);
   if (!more && !unresolved.length) await finishSync(userId, state.run_id);
 } catch (error) {
   reportFailure("finance_sync_paused", error, {}, {userId});
   const reconnect = error instanceof GoogleConnectionRequiredError;
   await saveSync(state, cursor, reconnect ? "blocked" : "queued", reconnect ? "Reconnect Google" : error instanceof ModelBudgetExceededError ? "AI token budget reached; progress saved for retry after the budget resets" : "Scan paused; it will resume without importing anything");
 }
 return loadSync(userId);
}
