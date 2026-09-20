import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listFeedback, setFeedback } from "@/lib/conversations/store";

const idSchema = z.string().uuid();
const bodySchema = z.object({ sequence: z.string().regex(/^\d+$/), rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]), note: z.string().max(500).optional() });

async function authenticate() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return error || typeof userId !== "string" ? null : userId;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticate();
  if (!userId) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return Response.json({ feedback: await listFeedback(userId, id.data) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticate();
  if (!userId) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = idSchema.safeParse((await params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const saved = await setFeedback(userId, id.data, body.data.sequence, body.data.rating, body.data.note);
  if (!saved) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  return new Response(null, { status: 204 });
}
