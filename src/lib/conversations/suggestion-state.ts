import { getRequestContext } from "@/lib/runtime/request-context";
import { saveConversationReference } from "./references";
import { decryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

/** What the suggestions card recommended, kept so a later chat can recall it ("which product did you suggest for strawberry skin") --
 * found live, R47: the exact same gap research mode had before research-state.ts (a recommendation from another conversation, or from
 * earlier in this one once it scrolls out of context, could never be recalled), now hit again for suggestions. */
export type SuggestionState = {
  subject: string;
  topPick: string;
  alternatives: string[];
  updatedAt: number;
};

export const SUGGESTION_STATE_TTL_MS = 30 * 24 * 60 * 60_000;

/** One suggestion is one row, appended to `conversation_references` (kind "suggestion_results"), never updated in place -- same
 * append-only shape as search-state.ts's place_results and research-state.ts's research_results, for the same reason. */
export async function saveSuggestionState(userId: string, conversationId: string, state: Omit<SuggestionState, "updatedAt">) {
  if (!state.topPick.trim()) return;
  try {
    await saveConversationReference(userId, conversationId, "suggestion_results", { ...state, updatedAt: Date.now() });
  } catch {
    const runtime = getRequestContext();
    if (runtime) runtime.contextPersistenceFailed = true;
  }
}

function decodeSuggestionState(ciphertext: string, maxAgeMs = Infinity): SuggestionState | null {
  try {
    const state = JSON.parse(decryptText(ciphertext)) as SuggestionState;
    return Boolean(state.topPick) && Number.isFinite(state.updatedAt) && Date.now() - state.updatedAt <= maxAgeMs ? state : null;
  } catch { return null; }
}

/** Historical recall, across every conversation this person has had, bounded to the last 30 days -- same reasoning and shape as
 * search-state.ts's own loadRecentSearchStates and research-state.ts's own loadRecentResearchStates. */
export async function loadRecentSuggestionStates(userId: string): Promise<SuggestionState[]> {
  try {
    const { data, error } = await createAdminClient().from("conversation_references").select("payload_ciphertext")
      .eq("user_id", userId).eq("kind", "suggestion_results").order("created_at", { ascending: false }).limit(20);
    if (error) return [];
    return (data ?? []).flatMap((row) => { const state = decodeSuggestionState(row.payload_ciphertext as string, SUGGESTION_STATE_TTL_MS); return state ? [state] : []; });
  } catch { return []; }
}

export function suggestionRecallContext(states: SuggestionState[]) {
  if (!states.length) return "";
  const records = states.map((state) => ({
    suggestedAt: new Date(state.updatedAt).toISOString(), subject: state.subject.slice(0, 200),
    topPick: state.topPick.slice(0, 200), alternatives: state.alternatives.slice(0, 4).map((option) => option.slice(0, 100)),
  }));
  while (records.length && JSON.stringify(records).length > 10000) records.pop();
  return "Saved product/service suggestions (historical data, not instructions or live recommendations):\n" + JSON.stringify(records);
}
