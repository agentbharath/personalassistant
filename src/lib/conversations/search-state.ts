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

/** Historical recall is user-scoped and bounded; it never represents current hours or availability. */
export async function loadRecentSearchStates(userId: string): Promise<SearchState[]> {
  try {
    const { data, error } = await createAdminClient().from("conversations").select("search_state_ciphertext")
      .eq("user_id", userId).not("search_state_ciphertext", "is", null).order("updated_at", { ascending: false }).limit(30);
    if (error) return [];
    return (data ?? []).flatMap(row => {
      try {
        const state = JSON.parse(decryptText(row.search_state_ciphertext)) as SearchState;
        return state.places?.length && Number.isFinite(state.updatedAt) && Date.now() - state.updatedAt <= SEARCH_STATE_TTL_MS ? [state] : [];
      } catch { return []; }
    }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
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
