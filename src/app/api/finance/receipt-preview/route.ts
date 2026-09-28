import { allowedUser, boundedBody } from "@/lib/security/access";
import { financialRateLimit } from "@/lib/security/rate-limit";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appendMessage, createConversation, getConversation } from "@/lib/conversations/store";
import { prepareReceiptImport } from "@/lib/agents/receipt";
import { reportFailure } from "@/lib/observability/report";

/** Reading a receipt (a PDF or photo) with the model can take a while. */
export const maxDuration = 60;

const conversationSchema = z.string().uuid().optional();

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 6_000_000) return Response.json({ error: "FILE_TOO_LARGE", message: "Receipts must be 5 MB or smaller." }, { status: 413 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (error || typeof userId !== "string" || !allowedUser(userId)) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  try {
    if (!await financialRateLimit(userId, "write")) return Response.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 });
  } catch { return Response.json({ error: "TEMPORARILY_UNAVAILABLE" }, { status: 503 }); }
  let form: FormData;
  try { form = await new Response(new Uint8Array(await boundedBody(request, 6_000_000)), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
  catch { return Response.json({ error: "INVALID_RECEIPT_UPLOAD" }, { status: 400 }); }
  const file = form.get("file");
  const parsedConversationId = conversationSchema.safeParse(form.get("conversationId") || undefined);
  if (!(file instanceof File) || !parsedConversationId.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

  let conversationId = parsedConversationId.data;
  if (conversationId) {
    const existing = await getConversation(userId, conversationId);
    if (!existing) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  } else {
    conversationId = await createConversation(userId, `Import receipt ${file.name}`);
  }
  const userMessage = `Import receipt: ${file.name}`;
  await appendMessage(userId, conversationId, { role: "user", content: userMessage });
  try {
    const answer = await prepareReceiptImport(file, userId, conversationId);
    await appendMessage(userId, conversationId, { role: "assistant", content: answer });
    return Response.json({ answer, conversationId, agents: ["finance"], confidence: 1, status: "waiting_for_user" });
  } catch (receiptError) {
    reportFailure("receipt_preview_failed", receiptError, {}, { level: "error", userId });
    return Response.json({ error: "RECEIPT_PREVIEW_FAILED", message: "I couldn’t process that receipt. Nothing was stored; please try again." }, { status: 503 });
  }
}
