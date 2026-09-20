import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getConversationMessagesPage } from "@/lib/conversations/store";

const querySchema = z.object({ before: z.string().regex(/^\d+$/) });
const idSchema = z.string().uuid();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = idSchema.safeParse((await params).id);
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !query.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const page = await getConversationMessagesPage(userId, id.data, query.data.before);
  if (!page) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  return Response.json(page, { headers: { "cache-control": "private, no-store" } });
}
