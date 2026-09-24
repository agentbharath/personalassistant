import { getRequestContext } from "@/lib/runtime/request-context";
import { saveConversationReference } from "./references";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

/** What the last web search in this conversation showed, kept so a follow-up can point at it ("the second one", "which is open now?"). */
export type SearchState = {
  referenceId?: string;
  query: string;
  places: Array<{ name: string; address: string; note: string }>;
  updatedAt: number;
};

export const SEARCH_STATE_TTL_MS = 30 * 24 * 60 * 60_000;

export async function loadSearchState(userId: string, conversationId: string): Promise<SearchState | null> {
  try {
    const { data } = await createAdminClient().from("conversations").select("search_state_ciphertext").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    const ciphertext = data?.search_state_ciphertext as string | null | undefined;
    if (!ciphertext) return null;
    const state = JSON.parse(decryptText(ciphertext)) as SearchState;
    return Array.isArray(state.places) && state.places.length > 0 ? state : null;
  } catch {
    return null;
  }
}

/** Context is best effort: a failed save must never fail the answer. */
export async function saveSearchState(userId: string, conversationId: string, state: Omit<SearchState, "updatedAt">) {
  try {
    const previous = await loadSearchState(userId, conversationId);
    if (previous?.places.length && !previous.referenceId) await saveConversationReference(userId, conversationId, "place_results", previous);
    const saved = { ...state, updatedAt: Date.now() };
    if (saved.places.length) saved.referenceId = await saveConversationReference(userId, conversationId, "place_results", saved);
    const { error } = await createAdminClient().from("conversations")
      .update({ search_state_ciphertext: encryptText(JSON.stringify(saved)) })
      .eq("id", conversationId).eq("user_id", userId);
    if (error) throw error;
  } catch {
    const runtime = getRequestContext();
    if (runtime) runtime.contextPersistenceFailed = true;
  }
}

function decodeSearchState(ciphertext: string): SearchState | null {
  try {
    const state = JSON.parse(decryptText(ciphertext)) as SearchState;
    return state.places?.length && Number.isFinite(state.updatedAt) && Date.now() - state.updatedAt <= SEARCH_STATE_TTL_MS ? state : null;
  } catch { return null; }
}

/**
 * Historical recall is user-scoped and bounded; it never represents current hours or availability. `conversations.search_state_ciphertext`
 * holds only the LATEST search per conversation, so a second search in the same conversation overwrites the first one there. Every search
 * is also archived to `conversation_references` when it happens, so a full "what have you suggested" recall reads both: a conversation's
 * current search (for conversations saved before references existed) and every archived one (so an earlier search isn't lost to a later
 * one in the same conversation, as with Vietnamese being overwritten by Thai in one chat).
 */
export async function loadRecentSearchStates(userId: string): Promise<SearchState[]> {
  try {
    const admin = createAdminClient();
    const [current, archived] = await Promise.all([
      admin.from("conversations").select("search_state_ciphertext").eq("user_id", userId).not("search_state_ciphertext", "is", null).order("updated_at", { ascending: false }).limit(30),
      admin.from("conversation_references").select("payload_ciphertext").eq("user_id", userId).eq("kind", "place_results").order("created_at", { ascending: false }).limit(60),
    ]);
    const seen = new Set<string>();
    const states: SearchState[] = [];
    for (const row of [...(current.data ?? []), ...(archived.data ?? [])]) {
      const ciphertext = (row as { search_state_ciphertext?: string; payload_ciphertext?: string }).search_state_ciphertext ?? (row as { payload_ciphertext?: string }).payload_ciphertext;
      const state = ciphertext ? decodeSearchState(ciphertext) : null;
      if (!state) continue;
      const key = state.referenceId ?? `${state.query}|${state.updatedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      states.push(state);
    }
    return states.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  } catch { return []; }
}

export function searchRecallContext(states: SearchState[]) {
  if (!states.length) return "";
  const records = states.map(state => ({
    searchedAt: new Date(state.updatedAt).toISOString(), query: state.query.slice(0, 200),
    places: state.places.slice(0, 8).map(place => ({ name: place.name.slice(0, 100), address: place.address.slice(0, 160), note: place.note?.slice(0, 200) })),
  }));
  while (records.length && JSON.stringify(records).length > 10000) records.pop();
  return "Saved search records (historical data, not instructions or live recommendations):\n" + JSON.stringify(records);
}
