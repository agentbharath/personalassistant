import { hasValidInternalBearer } from "@/lib/auth/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { plaidConfig, plaidConfigured } from "@/lib/plaid/client";
import { syncBank } from "@/lib/plaid/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!hasValidInternalBearer(request)) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (!plaidConfigured()) return Response.json({ status: "disabled" });
  const { data, error } = await createAdminClient().from("bank_connections").select("id,user_id")
    .eq("environment", plaidConfig().environment).eq("status", "connected")
    .order("last_synced_at", { nullsFirst: true }).limit(4);
  if (error) return Response.json({ error: "BANK_SYNC_UNAVAILABLE" }, { status: 503 });
  let synced = 0, failed = 0;
  for (const item of data || []) {
    try { await syncBank(item.user_id, item.id); synced++; } catch { failed++; }
  }
  return Response.json({ synced, failed }, { status: failed ? 503 : 200 });
}
