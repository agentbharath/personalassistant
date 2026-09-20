import type { EmailRequest } from "@/lib/agents/email-request";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

export type EmailState = {
  /** The request as understood, with the default window left unset so a learned default can be re-applied. */
  request: EmailRequest;
  results: Array<{ id: string; subject: string; from: string; date: string }>;
  updatedAt: number;
};

export const EMAIL_STATE_TTL_MS = 30 * 60_000;

export async function loadEmailState(userId: string, conversationId: string): Promise<EmailState | null> {
  try {
    const { data } = await createAdminClient().from("conversations").select("email_state_ciphertext").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    const ciphertext = data?.email_state_ciphertext as string | null | undefined;
    if (!ciphertext) return null;
    const state = JSON.parse(decryptText(ciphertext)) as EmailState;
    return Date.now() - state.updatedAt <= EMAIL_STATE_TTL_MS ? state : null;
  } catch {
    return null;
  }
}

/** Context is best effort: a failed save must never fail the answer. */
export async function saveEmailState(userId: string, conversationId: string, state: Omit<EmailState, "updatedAt">) {
  try {
    await createAdminClient().from("conversations")
      .update({ email_state_ciphertext: encryptText(JSON.stringify({ ...state, updatedAt: Date.now() })) })
      .eq("id", conversationId).eq("user_id", userId);
  } catch {
    // ignore
  }
}
