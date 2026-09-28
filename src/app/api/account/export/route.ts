import { allowedUser } from "@/lib/security/access";
import { financialRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { buildAccountExport } from "@/lib/account/export";

/** Exporting everything for one person reads several tables. */
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (error || typeof userId !== "string" || !allowedUser(userId)) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const email = data?.user?.email ?? null;
  try {
    if (!await financialRateLimit(userId, "export")) return Response.json({ error: "TOO_MANY_EXPORTS" }, { status: 429, headers: { "retry-after": "600", "cache-control": "no-store" } });
  } catch { return Response.json({ error: "EXPORT_TEMPORARILY_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } }); }
  const body = JSON.stringify(await buildAccountExport(userId, email), null, 2);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="daylark-export-${day}.json"`, "cache-control": "private, no-store" } });
}
