import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as { id: string; user_id: string; conversation_id: string; kind: string; payload_ciphertext: string; created_at: string }[], conversations: [] as string[] }));
vi.mock("@/lib/security/encryption", () => ({ decryptText: (s: string) => s, encryptText: (s: string) => s }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: "conversations" | "conversation_references") => {
      let user = ""; let conversation = ""; let kind = "";
      if (table === "conversations") {
        let convId = "";
        const query = { select: () => query, eq: (key: string, v: string) => { if (key === "id") convId = v; return query; }, maybeSingle: async () => ({ data: db.conversations.includes(convId) ? { id: convId } : null }) };
        return query;
      }
      // Newest first, matching the real query's `order("created_at", { ascending: false })`.
      const rows = () => [...db.rows].reverse().filter((row) => row.user_id === user && (!conversation || row.conversation_id === conversation) && (!kind || row.kind === kind));
      // limit() is a terminal step in the real client too, but it's also chainable with .maybeSingle(): support both by returning a
      // thenable (so a bare `await` resolves the list) that also exposes .maybeSingle().
      const limited = (n: number) => ({
        then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: rows().slice(0, n), error: null }),
        maybeSingle: async () => ({ data: rows().slice(0, n)[0] ?? null, error: null }),
      });
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { if (key === "user_id") user = value; if (key === "conversation_id") conversation = value; if (key === "kind") kind = value; return query; },
        order: () => query,
        limit: (n: number) => limited(n),
        insert: (row: { user_id: string; conversation_id: string; kind: string; payload_ciphertext: string }) => ({
          select: () => ({ single: async () => { const saved = { id: `ref${db.rows.length}`, created_at: new Date().toISOString(), ...row }; db.rows.push(saved); return { data: { id: saved.id }, error: null }; } }),
        }),
      };
      return query;
    },
  }),
}));
import { loadRecentSearchStates, loadSearchState, renderSearchHistory, saveSearchState, searchRecallContext } from "./search-state";
beforeEach(() => { db.rows = []; db.conversations = ["c", "c2"]; });

it("recalls yesterday's restaurants across conversations without exposing another user's records", async () => {
  const state = { query: "Chinese restaurants Sunnyvale", updatedAt: Date.now() - 86400000, places: [{ name: "Ginger Cafe", address: "Sunnyvale", note: "Previously suggested" }] };
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "place_results", payload_ciphertext: JSON.stringify(state), created_at: "" },
    { id: "r2", user_id: "other", conversation_id: "c", kind: "place_results", payload_ciphertext: JSON.stringify({ ...state, query: "Private other user" }), created_at: "" },
  ];
  expect((await loadSearchState("u", "c"))?.places[0].name).toBe("Ginger Cafe");
  const records = await loadRecentSearchStates("u");
  expect(records).toEqual([state]);
  expect(searchRecallContext(records)).toContain("historical data");
  expect(searchRecallContext(records)).not.toContain("Private other user");
});

it("ignores corrupt or expired records without inventing memories", async () => {
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "place_results", payload_ciphertext: "broken", created_at: "" },
    { id: "r2", user_id: "u", conversation_id: "c", kind: "place_results", payload_ciphertext: JSON.stringify({ updatedAt: Date.now() - 31 * 86400000, places: [{ name: "Old" }] }), created_at: "" },
  ];
  expect(await loadRecentSearchStates("u")).toEqual([]);
});

it("retains this conversation's place list after months, independently of cross-chat recall", async () => {
  const state = { query: "Chinese restaurants", updatedAt: Date.now() - 180 * 86400000, places: [{ name: "Ginger Cafe" }] };
  db.rows = [{ id: "r1", user_id: "u", conversation_id: "c", kind: "place_results", payload_ciphertext: JSON.stringify(state), created_at: "" }];
  expect(await loadSearchState("u", "c")).toEqual(state);
  expect(await loadRecentSearchStates("u")).toEqual([]);
});

it("a second search in the same conversation never pushes the first out of cross-chat recall (each search is its own row)", async () => {
  await saveSearchState("u", "c", { query: "Vietnamese restaurants Sunnyvale", places: [{ name: "Pho Nam", address: "", note: "" }] });
  await saveSearchState("u", "c", { query: "Thai restaurants Sunnyvale", places: [{ name: "Thai Spoons", address: "", note: "" }] });
  expect((await loadSearchState("u", "c"))?.query).toBe("Thai restaurants Sunnyvale");
  const records = await loadRecentSearchStates("u");
  expect(records.map((r) => r.query)).toEqual(["Thai restaurants Sunnyvale", "Vietnamese restaurants Sunnyvale"]);
});

it("saves nothing for an empty result, so a failed search cannot look like a real, empty suggestion", async () => {
  await saveSearchState("u", "c", { query: "Nonexistent cuisine", places: [] });
  expect(await loadSearchState("u", "c")).toBeNull();
});

it("renders a saved-search list deterministically, grouped by search, newest occurrence winning a repeated place, oldest group first", () => {
  const states = [
    { query: "Thai restaurants in Sunnyvale, CA", updatedAt: 3, places: [{ name: "Thai Spoons", address: "", note: "" }] },
    { query: "best orange chicken Ginger Cafe P.F. Chang's Sunnyvale CA", updatedAt: 2, places: [{ name: "P.F. Chang's", address: "", note: "" }, { name: "Ginger Cafe", address: "", note: "" }] },
    { query: "Chinese restaurants in Sunnyvale, CA", updatedAt: 1, places: [{ name: "Ginger Cafe", address: "", note: "" }, { name: "P.F. Chang's", address: "", note: "" }, { name: "Hunan House", address: "", note: "" }] },
  ]; // newest first, as loadRecentSearchStates returns them
  const text = renderSearchHistory(states as never);
  expect(text).toBe(
    "Here's everything from your saved searches (last 30 days):\n\n" +
    "**Chinese**\n- Hunan House\n\n" +
    "**best orange chicken Ginger Cafe P.F. Chang's Sunnyvale CA**\n- P.F. Chang's\n- Ginger Cafe\n\n" +
    "**Thai**\n- Thai Spoons"
  );
});

it("says plainly when there is nothing saved, rather than an empty list", () => {
  expect(renderSearchHistory([])).toBe("You don't have any saved place searches from the last 30 days.");
});
