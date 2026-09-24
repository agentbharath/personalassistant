import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as { user_id: string; search_state_ciphertext: string }[], users: [] as string[] }));
vi.mock("@/lib/security/encryption", () => ({ decryptText: (s: string) => s, encryptText: (s: string) => s }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let user = "";
  const query = { select: () => query, eq: (_key: string, value: string) => { user = value; db.users.push(user); return query; }, not: () => query, order: () => query, limit: async () => ({ data: db.rows.filter(row => row.user_id === user) }), maybeSingle: async () => ({ data: db.rows.find(row => row.user_id === user) }) };
  return query;
} }) }));
import { loadRecentSearchStates, loadSearchState, searchRecallContext } from "./search-state";
beforeEach(() => { db.rows = []; db.users = []; });
it("recalls yesterday's restaurants across conversations without exposing another user's records", async () => {
  const state = { query: "Chinese restaurants Sunnyvale", updatedAt: Date.now() - 86400000, places: [{ name: "Ginger Cafe", address: "Sunnyvale", note: "Previously suggested" }] };
  db.rows = [{ user_id: "u", search_state_ciphertext: JSON.stringify(state) }, { user_id: "other", search_state_ciphertext: JSON.stringify({ ...state, query: "Private other user" }) }];
  expect((await loadSearchState("u", "c"))?.places[0].name).toBe("Ginger Cafe");
  const records = await loadRecentSearchStates("u");
  expect(records).toEqual([state]);
  expect(searchRecallContext(records)).toContain("historical data");
  expect(searchRecallContext(records)).not.toContain("Private other user");
});
it("ignores corrupt or expired records without inventing memories", async () => {
  db.rows = [{ user_id: "u", search_state_ciphertext: "broken" }, { user_id: "u", search_state_ciphertext: JSON.stringify({ updatedAt: Date.now() - 31 * 86400000, places: [{ name: "Old" }] }) }];
  expect(await loadRecentSearchStates("u")).toEqual([]);
});
it("retains this conversation's place list after months, independently of cross-chat recall", async () => {
 const state = { query: "Chinese restaurants", updatedAt: Date.now() - 180 * 86400000, places: [{name: "Ginger Cafe"}] };
 db.rows = [{user_id: "u", search_state_ciphertext: JSON.stringify(state)}];
 expect(await loadSearchState("u", "c")).toEqual(state);
 expect(await loadRecentSearchStates("u")).toEqual([]);
});
