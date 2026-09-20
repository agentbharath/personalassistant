import { createClient } from "@/lib/supabase/server";
import { buildAccountExport } from "@/lib/account/export";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  const body = JSON.stringify(await buildAccountExport(userId, email), null, 2);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="daylark-export-${day}.json"`, "cache-control": "private, no-store" } });
}
