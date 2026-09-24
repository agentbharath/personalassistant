import { getRequestContext } from "@/lib/runtime/request-context";
import { saveConversationReference } from "./references";
import { decryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

/** What a web search showed, kept so a follow-up can point at it ("the second one", "which is open now?") or a later chat can recall it. */
export type SearchState = {
  query: string;
  places: Array<{ name: string; address: string; note: string }>;
  updatedAt: number;
};

export const SEARCH_STATE_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * One search is one row: every search is simply appended to `conversation_references` (kind "place_results"), never updated in place. The
 * same log answers two different questions just by who it's filtered for: the latest row for this conversation is "what did we just show
 * in this chat" (below), and the latest rows for this person across every conversation is "what have you suggested lately"
 * (`loadRecentSearchStates`). There is nothing to overwrite and nothing to archive, so an earlier search in a chat can never be pushed out
 * by a later one in the same chat.
 */
export async function saveSearchState(userId: string, conversationId: string, state: Omit<SearchState, "updatedAt">) {
  if (!state.places.length) return;
  try {
    await saveConversationReference(userId, conversationId, "place_results", { ...state, updatedAt: Date.now() });
  } catch {
    const runtime = getRequestContext();
    if (runtime) runtime.contextPersistenceFailed = true;
  }
}

function decodeSearchState(ciphertext: string, maxAgeMs = Infinity): SearchState | null {
  try {
    const state = JSON.parse(decryptText(ciphertext)) as SearchState;
    return state.places?.length && Number.isFinite(state.updatedAt) && Date.now() - state.updatedAt <= maxAgeMs ? state : null;
  } catch { return null; }
}

/** The most recent search shown in this one conversation, for a same-chat follow-up ("the second one"). No age limit: the conversation itself is the only thing that ages it out. */
export async function loadSearchState(userId: string, conversationId: string): Promise<SearchState | null> {
  try {
    const { data, error } = await createAdminClient().from("conversation_references").select("payload_ciphertext")
      .eq("user_id", userId).eq("conversation_id", conversationId).eq("kind", "place_results").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return decodeSearchState(data.payload_ciphertext as string);
  } catch { return null; }
}

/** Historical recall, across every conversation this person has had, bounded to the last 30 days. Never represents current hours or availability. */
export async function loadRecentSearchStates(userId: string): Promise<SearchState[]> {
  try {
    const { data, error } = await createAdminClient().from("conversation_references").select("payload_ciphertext")
      .eq("user_id", userId).eq("kind", "place_results").order("created_at", { ascending: false }).limit(20);
    if (error) return [];
    return (data ?? []).flatMap((row) => { const state = decodeSearchState(row.payload_ciphertext as string, SEARCH_STATE_TTL_MS); return state ? [state] : []; });
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
