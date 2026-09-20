import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MAX_PINNED, deleteConversation, updateConversation } from "@/lib/conversations/store";

const idSchema = z.string().uuid();
const patchSchema = z.object({ title: z.string().trim().min(1).max(80).optional(), pinned: z.boolean().optional() })
  .refine((value) => value.title !== undefined || value.pinned !== undefined, { message: "Nothing to change" });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = idSchema.safeParse((await params).id);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const updated = await updateConversation(userId, id.data, body.data);
  if (updated === "pin_limit") return Response.json({ error: "PIN_LIMIT", message: `You can pin up to ${MAX_PINNED} chats. Unpin one first.` }, { status: 409 });
  if (!updated) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  return new Response(null, { status: 204 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const deleted = await deleteConversation(userId, id.data);
  if (!deleted) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  return new Response(null, { status: 204 });
}
