import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  conversations: [] as { user_id: string; search_state_ciphertext: string }[],
  references: [] as { user_id: string; kind: string; payload_ciphertext: string }[],
}));
vi.mock("@/lib/security/encryption", () => ({ decryptText: (s: string) => s, encryptText: (s: string) => s }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: "conversations" | "conversation_references") => {
      let user = "";
      let kind: string | undefined;
      const rows = () => (table === "conversations" ? db.conversations : db.references).filter((row) => row.user_id === user && (!kind || (row as { kind?: string }).kind === kind));
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { if (key === "user_id") user = value; if (key === "kind") kind = value; return query; },
        not: () => query,
        order: () => query,
        limit: async () => ({ data: rows() }),
        maybeSingle: async () => ({ data: rows()[0] }),
      };
      return query;
    },
  }),
}));
import { loadRecentSearchStates, loadSearchState, searchRecallContext } from "./search-state";
beforeEach(() => { db.conversations = []; db.references = []; });

it("recalls yesterday's restaurants across conversations without exposing another user's records", async () => {
  const state = { query: "Chinese restaurants Sunnyvale", updatedAt: Date.now() - 86400000, places: [{ name: "Ginger Cafe", address: "Sunnyvale", note: "Previously suggested" }] };
  db.conversations = [{ user_id: "u", search_state_ciphertext: JSON.stringify(state) }, { user_id: "other", search_state_ciphertext: JSON.stringify({ ...state, query: "Private other user" }) }];
  expect((await loadSearchState("u", "c"))?.places[0].name).toBe("Ginger Cafe");
  const records = await loadRecentSearchStates("u");
  expect(records).toEqual([state]);
  expect(searchRecallContext(records)).toContain("historical data");
  expect(searchRecallContext(records)).not.toContain("Private other user");
});

it("ignores corrupt or expired records without inventing memories", async () => {
  db.conversations = [{ user_id: "u", search_state_ciphertext: "broken" }, { user_id: "u", search_state_ciphertext: JSON.stringify({ updatedAt: Date.now() - 31 * 86400000, places: [{ name: "Old" }] }) }];
  expect(await loadRecentSearchStates("u")).toEqual([]);
});

it("retains this conversation's place list after months, independently of cross-chat recall", async () => {
 const state = { query: "Chinese restaurants", updatedAt: Date.now() - 180 * 86400000, places: [{name: "Ginger Cafe"}] };
 db.conversations = [{user_id: "u", search_state_ciphertext: JSON.stringify(state)}];
 expect(await loadSearchState("u", "c")).toEqual(state);
 expect(await loadRecentSearchStates("u")).toEqual([]);
});

it("a second search in the same conversation overwrites the visible state, but recall still finds the first one from its archive", async () => {
  // Vietnamese, then Thai, asked in one chat: only Thai remains the conversation's current state, but Vietnamese was archived when it was superseded.
  const vietnamese = { referenceId: "r1", query: "Vietnamese restaurants Sunnyvale", updatedAt: Date.now() - 60000, places: [{ name: "Pho Nam" }] };
  const thai = { referenceId: "r2", query: "Thai restaurants Sunnyvale", updatedAt: Date.now(), places: [{ name: "Thai Spoons" }] };
  db.conversations = [{ user_id: "u", search_state_ciphertext: JSON.stringify(thai) }];
  db.references = [
    { user_id: "u", kind: "place_results", payload_ciphertext: JSON.stringify(vietnamese) },
    { user_id: "u", kind: "place_results", payload_ciphertext: JSON.stringify(thai) },
  ];
  const records = await loadRecentSearchStates("u");
  expect(records.map((r) => r.query)).toEqual(["Thai restaurants Sunnyvale", "Vietnamese restaurants Sunnyvale"]);
});

it("never lists the same search twice when it is both the current state and its own archived copy", async () => {
  const state = { referenceId: "r1", query: "Chinese restaurants Sunnyvale", updatedAt: Date.now(), places: [{ name: "Ginger Cafe" }] };
  db.conversations = [{ user_id: "u", search_state_ciphertext: JSON.stringify(state) }];
  db.references = [{ user_id: "u", kind: "place_results", payload_ciphertext: JSON.stringify(state) }];
  expect(await loadRecentSearchStates("u")).toHaveLength(1);
});
