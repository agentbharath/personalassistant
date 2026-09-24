import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/security/encryption";
import type { EmailState } from "./email-state";
import type { SearchState } from "./search-state";
export type ConversationReference = { id: string; createdAt: string } & ({ kind: "email_results"; state: EmailState } | { kind: "place_results"; state: SearchState });

export async function saveConversationReference(userId: string, conversationId: string, kind: ConversationReference["kind"], state: EmailState | SearchState) {
  const admin = createAdminClient();
  const { data: owner, error: ownerError } = await admin.from("conversations").select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) throw new Error("CONVERSATION_NOT_FOUND");
  const { data, error } = await admin.from("conversation_references").insert({ user_id: userId, conversation_id: conversationId, kind, payload_ciphertext: encryptText(JSON.stringify(state)) }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
export function decodeReference(row: { id: string; kind: string; payload_ciphertext: string; created_at: string }): ConversationReference | null {
  try {
    const state = JSON.parse(decryptText(row.payload_ciphertext));
    if (row.kind === "email_results" && Array.isArray(state.results) && state.request) return { id: row.id, kind: row.kind, state, createdAt: row.created_at };
    if (row.kind === "place_results" && Array.isArray(state.places)) return { id: row.id, kind: row.kind, state, createdAt: row.created_at };
  } catch { /* A corrupt snapshot cannot supply references. */ }
  return null;
}
