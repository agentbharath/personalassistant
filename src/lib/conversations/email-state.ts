import { getRequestContext } from "@/lib/runtime/request-context";
import { saveConversationReference } from "./references";
import type { EmailRequest } from "@/lib/agents/email-request";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

export type EmailState = {
  /** The request as understood, with the default window left unset so a learned default can be re-applied. */
  referenceId?: string;
  request: EmailRequest;
  results: Array<{ id: string; subject: string; from: string; date: string }>;
  updatedAt: number;
};


export async function loadEmailState(userId: string, conversationId: string): Promise<EmailState | null> {
  try {
    const { data } = await createAdminClient().from("conversations").select("email_state_ciphertext").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    const ciphertext = data?.email_state_ciphertext as string | null | undefined;
    if (!ciphertext) return null;
    const state = JSON.parse(decryptText(ciphertext)) as EmailState;
    return state.request && Array.isArray(state.results) ? state : null;
  } catch {
    return null;
  }
}

/** Context is best effort: a failed save must never fail the answer. */
export async function saveEmailState(userId: string, conversationId: string, state: Omit<EmailState, "updatedAt">) {
  try {
    const previous = await loadEmailState(userId, conversationId);
    if (previous?.results.length && !previous.referenceId) await saveConversationReference(userId, conversationId, "email_results", previous);
    const saved = { ...state, updatedAt: Date.now() };
    if (state.results.length) saved.referenceId = await saveConversationReference(userId, conversationId, "email_results", saved);
    const { error } = await createAdminClient().from("conversations")
      .update({ email_state_ciphertext: encryptText(JSON.stringify(saved)) })
      .eq("id", conversationId).eq("user_id", userId);
    if (error) throw error;
  } catch {
    const runtime = getRequestContext();
    if (runtime) runtime.contextPersistenceFailed = true;
  }
}
