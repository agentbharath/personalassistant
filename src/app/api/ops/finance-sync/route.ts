import { randomUUID } from "node:crypto";
import { hasValidInternalBearer } from "@/lib/auth/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRequestContext } from "@/lib/runtime/request-context";
import { enabled, queueSync } from "@/lib/finance-sync/store";
import { advanceFinanceSync } from "@/lib/finance-sync/runner";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
 if (!hasValidInternalBearer(request)) return Response.json({error: "AUTHENTICATION_REQUIRED"}, {status: 401});
 if (!enabled()) return Response.json({status: "disabled"});
 const {data, error} = await createAdminClient().from("finance_sync_state").select("user_id").in("status", ["queued", "running", "idle"]).order("updated_at").limit(4);
 if (error) return Response.json({error: "SYNC_UNAVAILABLE"}, {status: 503});
 let advanced = 0;
 const deadline = Date.now() + 240000;
 for (const row of data ?? []) {
   if (Date.now() > deadline - 60000) break;
   await queueSync(row.user_id);
   await withRequestContext({userId: row.user_id, requestId: randomUUID(), startedAt: Date.now(), deadlineAt: Date.now() + 60000, costLimitUsd: 0.15}, () => advanceFinanceSync(row.user_id));
   advanced++;
 }
 return Response.json({advanced});
}
