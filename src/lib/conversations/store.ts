import { createClient } from "@/lib/supabase/server";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

export type StoredMessage = { role: "user" | "assistant"; content: string; sequence?: string };
export type ConversationSummary = { id: string; title: string; updatedAt: string; pinned?: boolean; pinnedAt?: string | null };
const DISPLAY_MESSAGE_LIMIT = 50;
const RECENT_CONTEXT_LIMIT = 12;

export async function createConversation(userId: string, firstMessage: string) {
  const supabase = await createClient();
  const title = summarizeConversationTitle(firstMessage);
  const { data, error } = await supabase.from("conversations").insert({
    user_id: userId,
    title: null,
    title_ciphertext: encryptText(title),
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** A title the user chose is shown exactly as typed; an automatic one is shortened from the first message. */
export function displayTitle(ciphertext: string | null, custom: boolean) {
  if (!ciphertext) return "Conversation";
  const text = decryptText(ciphertext);
  return custom ? text : summarizeConversationTitle(text);
}

export function summarizeConversationTitle(input: string) {
  const normalized = input.replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  const lower = normalized.toLowerCase();
  if (/calendar.*today|today.*calendar/.test(lower)) return "Today’s calendar";
  if (/movie/.test(lower) && /meeting/.test(lower)) return "Movie plans around meeting";
  if (/restaurant/.test(lower) && /spend/.test(lower)) return "Restaurant spending";
  if (/concert/.test(lower)) return "Concert plans";
  if (/debit.*transaction|transaction.*debit/.test(lower)) return "Debit transactions";
  const emailSender = normalized.match(/\bemails?\s+from\s+(.+?)(?:\s+(?:in|during|within|over|since|before|after|last|past)\b|[?.!,]|$)/i);
  if (emailSender) return `Email from ${emailSender[1].trim().slice(0, 30)}`;
  const expenseMerchant = normalized.match(/\b(?:spent|paid)\b.+?\b(?:at|to)\s+(.+?)(?:\s+(?:today|yesterday|tonight|now))?$/i);
  if (expenseMerchant) return `Expense at ${expenseMerchant[1].trim().slice(0, 30)}`;
  const concise = normalized.replace(/^(?:please\s+)?(?:can|could|would)\s+(?:you|i)\s+/i, "").replace(/^(?:tell|show)\s+me\s+/i, "");
  return concise.slice(0, 48).trim() || "New conversation";
}

export async function appendMessage(userId: string, conversationId: string, message: StoredMessage) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("append_conversation_message", {
    p_user_id: userId,
    p_conversation_id: conversationId,
    p_role: message.role,
    p_content_ciphertext: encryptText(message.content),
  });
  if (error) throw error;
}

export async function getConversation(userId: string, conversationId: string) {
  const supabase = await createClient();
  const [conversationResult, messageResult] = await Promise.all([
    supabase.from("conversations").select("id, title_ciphertext, title_custom, context_summary_ciphertext").eq("id", conversationId).eq("user_id", userId).maybeSingle(),
    supabase.from("conversation_messages").select("role, content_ciphertext, sequence_number").eq("conversation_id", conversationId).eq("user_id", userId).order("sequence_number", { ascending: false }).limit(DISPLAY_MESSAGE_LIMIT + 1),
  ]);
  const { data: conversation, error: conversationError } = conversationResult;
  if (conversationError) throw conversationError;
  if (!conversation) return null;
  const { data: messages, error: messageError } = messageResult;
  if (messageError) throw messageError;
  const hasMore = (messages?.length ?? 0) > DISPLAY_MESSAGE_LIMIT;
  const page = (messages ?? []).slice(0, DISPLAY_MESSAGE_LIMIT);
  const decryptedMessages = page.reverse().flatMap((message) => {
    if ((message.role !== "user" && message.role !== "assistant") || !message.content_ciphertext) return [];
    return [{ role: message.role, content: decryptText(message.content_ciphertext as string), sequence: String(message.sequence_number) } as StoredMessage];
  });
  const summary = conversation.context_summary_ciphertext ? decryptText(conversation.context_summary_ciphertext as string) : null;
  return {
    id: conversation.id as string,
    title: displayTitle(conversation.title_ciphertext as string | null, Boolean(conversation.title_custom)),
    messages: decryptedMessages,
    hasMore,
    oldestSequence: decryptedMessages[0]?.sequence,
    contextMessages: [
      ...(summary ? [{ role: "assistant" as const, content: `Earlier conversation summary:\n${summary}` }] : []),
      ...decryptedMessages.slice(-RECENT_CONTEXT_LIMIT),
    ],
  };
}

export async function getConversationMessagesPage(userId: string, conversationId: string, beforeSequence: string, limit = 50) {
  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase.from("conversations").select("id")
    .eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) return null;
  const pageSize = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase.from("conversation_messages")
    .select("role, content_ciphertext, sequence_number")
    .eq("conversation_id", conversationId).eq("user_id", userId)
    .lt("sequence_number", beforeSequence)
    .order("sequence_number", { ascending: false }).limit(pageSize + 1);
  if (error) throw error;
  const hasMore = (data?.length ?? 0) > pageSize;
  const messages = (data ?? []).slice(0, pageSize).reverse().flatMap((message) => {
    if ((message.role !== "user" && message.role !== "assistant") || !message.content_ciphertext) return [];
    return [{ role: message.role, content: decryptText(message.content_ciphertext as string), sequence: String(message.sequence_number) } as StoredMessage];
  });
  return { messages, hasMore, oldestSequence: messages[0]?.sequence };
}

export async function compactConversationContext(userId: string, conversationId: string) {
  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase.from("conversations")
    .select("context_summary_ciphertext, summarized_through_sequence")
    .eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (conversationError || !conversation) return;
  const { data: recent } = await supabase.from("conversation_messages").select("sequence_number")
    .eq("conversation_id", conversationId).eq("user_id", userId)
    .order("sequence_number", { ascending: false }).limit(RECENT_CONTEXT_LIMIT);
  if (!recent || recent.length < RECENT_CONTEXT_LIMIT) return;
  const cutoff = Math.min(...recent.map((message) => Number(message.sequence_number)));
  const summarizedThrough = Number(conversation.summarized_through_sequence ?? 0);
  if (cutoff <= summarizedThrough + 1) return;
  const { data: older, error: olderError } = await supabase.from("conversation_messages")
    .select("role, content_ciphertext, sequence_number")
    .eq("conversation_id", conversationId).eq("user_id", userId)
    .gt("sequence_number", summarizedThrough).lt("sequence_number", cutoff)
    .order("sequence_number", { ascending: true });
  if (olderError || !older?.length) return;
  const prior = conversation.context_summary_ciphertext ? decryptText(conversation.context_summary_ciphertext as string) : "";
  const additions = older.flatMap((message) => message.content_ciphertext && (message.role === "user" || message.role === "assistant")
    ? [`${message.role === "user" ? "User" : "Assistant"}: ${decryptText(message.content_ciphertext as string)}`]
    : []);
  const summary = buildContextCheckpoint(prior, additions);
  const lastSequence = Number(older.at(-1)?.sequence_number ?? summarizedThrough);
  await supabase.from("conversations").update({ context_summary_ciphertext: encryptText(summary), summarized_through_sequence: lastSequence })
    .eq("id", conversationId).eq("user_id", userId).eq("summarized_through_sequence", summarizedThrough);
}

export function buildContextCheckpoint(prior: string, additions: string[]) {
  const retainedPrior = prior.slice(-1_800);
  const newContext = additions.map((line) => line.replace(/\s+/g, " ").trim().slice(0, 320)).join("\n").slice(-2_200);
  return [retainedPrior, newContext].filter(Boolean).join("\n").slice(-4_000);
}

/**
 * Pinned chats first, then newest. `before` is the `updatedAt` of the last row already shown, for cursor paging
 * (later pages hold only unpinned chats). `query` matches titles, which are encrypted, so it is applied after decrypting.
 */
export async function listConversations(userId: string, options: { before?: string; limit?: number; query?: string } = {}): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const searching = Boolean(options.query?.trim());
  let query = supabase.from("conversations").select("id, title_ciphertext, title_custom, updated_at, pinned_at").eq("user_id", userId)
    .order("pinned_at", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }).limit(searching ? 500 : options.limit ?? 100);
  if (options.before && !searching) query = query.is("pinned_at", null).lt("updated_at", options.before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map((conversation) => ({
    id: conversation.id as string,
    title: displayTitle(conversation.title_ciphertext as string | null, Boolean(conversation.title_custom)),
    updatedAt: conversation.updated_at as string,
    pinned: conversation.pinned_at !== null,
    pinnedAt: (conversation.pinned_at as string | null) ?? null,
  }));
  if (!searching) return rows;
  const needle = options.query!.trim().toLowerCase();
  return rows.filter((row) => row.title.toLowerCase().includes(needle)).slice(0, options.limit ?? 50);
}

export const MAX_PINNED = 5;

/** Rename and/or pin a conversation the user owns. Returns false when it isn't theirs, or "pin_limit" when pinning would pass MAX_PINNED. */
export async function updateConversation(userId: string, conversationId: string, changes: { title?: string; pinned?: boolean }): Promise<boolean | "pin_limit"> {
  const supabase = await createClient();
  if (changes.pinned) {
    const { data: current } = await supabase.from("conversations").select("pinned_at").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    if (current && current.pinned_at === null) {
      const { count, error: countError } = await supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", userId).not("pinned_at", "is", null);
      if (countError) throw countError;
      if ((count ?? 0) >= MAX_PINNED) return "pin_limit";
    }
  }
  const patch: Record<string, unknown> = {};
  if (changes.title !== undefined) { patch.title_ciphertext = encryptText(changes.title); patch.title_custom = true; }
  if (changes.pinned !== undefined) patch.pinned_at = changes.pinned ? new Date().toISOString() : null;
  const { data, error } = await supabase.from("conversations").update(patch).eq("id", conversationId).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Thumbs up (1) or down (-1) on one answer; the same rating again clears it. */
export async function setFeedback(userId: string, conversationId: string, sequence: string, rating: 1 | -1 | 0, note?: string) {
  const supabase = await createClient();
  const { data: owned, error: ownedError } = await supabase.from("conversations").select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (ownedError) throw ownedError;
  if (!owned) return false;
  const key = { user_id: userId, conversation_id: conversationId, sequence_number: Number(sequence) };
  const { error } = rating === 0
    ? await supabase.from("message_feedback").delete().match(key)
    : await supabase.from("message_feedback").upsert({ ...key, rating, ...(note !== undefined ? { note_ciphertext: note.trim() ? encryptText(note.trim()) : null } : {}) });
  if (error) throw error;
  return true;
}

/** The sequence number of the newest message, used to address the answer that was just saved. */
export async function latestSequence(userId: string, conversationId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("conversation_messages").select("sequence_number").eq("conversation_id", conversationId).eq("user_id", userId).order("sequence_number", { ascending: false }).limit(1).maybeSingle();
  return data ? String(data.sequence_number) : undefined;
}

export async function listFeedback(userId: string, conversationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("message_feedback").select("sequence_number, rating").eq("user_id", userId).eq("conversation_id", conversationId);
  if (error) return {} as Record<string, 1 | -1>;
  return Object.fromEntries((data ?? []).map((row) => [String(row.sequence_number), row.rating as 1 | -1]));
}

export async function deleteConversation(userId: string, conversationId: string) {
  const supabase = await createClient();
  const { data: owned, error: ownershipError } = await supabase.from("conversations").select("id")
    .eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (ownershipError) throw ownershipError;
  if (!owned) return false;

  const admin = createAdminClient();
  const { data: checkpoints, error: checkpointReadError } = await admin.from("workflow_checkpoints").select("id")
    .eq("conversation_id", conversationId).eq("user_id", userId);
  if (checkpointReadError) throw checkpointReadError;
  const checkpointIds = (checkpoints ?? []).map((checkpoint) => checkpoint.id as string);
  if (checkpointIds.length) {
    const { error } = await admin.from("approvals").delete().eq("user_id", userId).in("workflow_checkpoint_id", checkpointIds);
    if (error) throw error;
  }
  const childDeletes = await Promise.all([
    admin.from("workflow_checkpoints").delete().eq("conversation_id", conversationId).eq("user_id", userId),
    admin.from("conversation_messages").delete().eq("conversation_id", conversationId).eq("user_id", userId),
  ]);
  const childError = childDeletes.find((result) => result.error)?.error;
  if (childError) throw childError;
  const { error: deleteError } = await admin.from("conversations").delete().eq("id", conversationId).eq("user_id", userId);
  if (deleteError) throw deleteError;
  return true;
}
