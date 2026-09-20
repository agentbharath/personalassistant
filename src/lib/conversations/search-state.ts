import { decryptText, encryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

/** What the last web search in this conversation showed, kept so a follow-up can point at it ("the second one", "which is open now?"). */
export type SearchState = {
  query: string;
  places: Array<{ name: string; address: string; note: string }>;
  updatedAt: number;
};

export const SEARCH_STATE_TTL_MS = 60 * 60_000;

export async function loadSearchState(userId: string, conversationId: string): Promise<SearchState | null> {
  try {
    const { data } = await createAdminClient().from("conversations").select("search_state_ciphertext").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    const ciphertext = data?.search_state_ciphertext as string | null | undefined;
    if (!ciphertext) return null;
    const state = JSON.parse(decryptText(ciphertext)) as SearchState;
    return Date.now() - state.updatedAt <= SEARCH_STATE_TTL_MS && state.places.length > 0 ? state : null;
  } catch {
    return null;
  }
}

/** Context is best effort: a failed save must never fail the answer. */
export async function saveSearchState(userId: string, conversationId: string, state: Omit<SearchState, "updatedAt">) {
  try {
    await createAdminClient().from("conversations")
      .update({ search_state_ciphertext: encryptText(JSON.stringify({ ...state, updatedAt: Date.now() })) })
      .eq("id", conversationId).eq("user_id", userId);
  } catch {
    // ignore
  }
}
