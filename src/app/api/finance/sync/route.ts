import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createConversation, appendMessage } from "@/lib/conversations/store";
import { enabled, loadSync, queueSync, candidates, freshnessLabel, retrySync, blockedDetails, excludeBlocked } from "@/lib/finance-sync/store";
import { prepareSyncReview } from "@/lib/finance-sync/review";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const schema = z.object({action: z.enum(["sync", "backfill", "review", "retry", "exclude"]), ids: z.array(z.string().uuid()).max(100).optional()});
async function actor() {
 const {data, error} = await (await createClient()).auth.getClaims();
 return !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}
export async function GET() {
 const userId = await actor();
 if (!userId) return Response.json({error: "AUTHENTICATION_REQUIRED"}, {status: 401});
 if (!enabled()) return Response.json({enabled: false});
 try {
   const state = await loadSync(userId);
   const rows = state ? await candidates(userId, state.run_id) : [];
   return Response.json({enabled: true, status: state?.status ?? "idle", checked: state?.checked ?? 0, pending: rows.filter(r => r.status === "pending").length, blocked: rows.filter(r => r.status === "blocked").length, blockedItems: rows.filter(r => r.status === "blocked").slice(0, 100).map(blockedDetails), note: freshnessLabel(state), error: state?.last_error ?? null}, {headers: {"cache-control": "private, no-store"}});
 } catch { return Response.json({error: "Email sync is unavailable."}, {status: 503}); }
}
export async function POST(request: Request) {
 const userId = await actor();
 if (!userId) return Response.json({error: "AUTHENTICATION_REQUIRED"}, {status: 401});
 if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({error: "INVALID_ORIGIN"}, {status: 403});
 if (!enabled()) return Response.json({error: "Email sync is not enabled."}, {status: 409});
 const parsed = schema.safeParse(await request.json().catch(() => null));
 if (!parsed.success) return Response.json({error: "INVALID_REQUEST"}, {status: 400});
 try {
   if (parsed.data.action === "review") {
     const conversationId = await createConversation(userId, "Review financial records from email");
     const answer = await prepareSyncReview(userId, conversationId);
     await appendMessage(userId, conversationId, {role: "user", content: "Review the financial records found by email sync"});
     await appendMessage(userId, conversationId, {role: "assistant", content: answer});
     return Response.json({url: `/?conversation=${conversationId}`});
   }
   if (parsed.data.action === "exclude") {
     await excludeBlocked(userId, parsed.data.ids ?? []);
     return Response.json({message: "The selected emails were excluded. No transactions were added."});
   }
   if (parsed.data.action === "retry") await retrySync(userId);
   else await queueSync(userId, undefined, parsed.data.action === "backfill");
   return Response.json({message: "Scan queued. It runs in the background; new records will need your approval."});
 } catch { return Response.json({error: "Couldn’t update the scan. Your saved transactions are unchanged."}, {status: 503}); }
}
