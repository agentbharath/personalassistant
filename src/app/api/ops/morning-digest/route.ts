import { randomUUID } from "node:crypto";
import { hasValidInternalBearer } from "@/lib/auth/internal-auth";
import { runMorningDigest } from "@/lib/digest/run";
import { withRequestContext } from "@/lib/runtime/request-context";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
 if (!hasValidInternalBearer(request)) return Response.json({error: "AUTHENTICATION_REQUIRED"}, {status: 401});
 try {
   const userId = process.env.WHATSAPP_DIGEST_USER_ID;
   if (!userId || process.env.WHATSAPP_DIGEST_ENABLED !== "true") return Response.json({status: "disabled"});
   const result = await withRequestContext({userId, requestId: randomUUID(), startedAt: Date.now(), deadlineAt: Date.now() + 55000, costLimitUsd: 0.10}, () => runMorningDigest());
   return Response.json(result, {status: ["failed", "unknown"].includes(result.status) ? 503 : 200});
 } catch { return Response.json({error: "DIGEST_UNAVAILABLE"}, {status: 503}); }
}
