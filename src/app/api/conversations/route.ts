import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listConversations } from "@/lib/conversations/store";

const querySchema = z.object({ before: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), q: z.string().trim().max(100).optional() });

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  // One extra row tells us whether another page exists.
  const rows = await listConversations(userId, { before: query.data.before, limit: query.data.limit + 1, query: query.data.q });
  return Response.json({ conversations: rows.slice(0, query.data.limit), hasMore: rows.length > query.data.limit }, { headers: { "cache-control": "private, no-store" } });
}
