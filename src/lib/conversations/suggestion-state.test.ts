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
      const rows = () => [...db.rows].reverse().filter((row) => row.user_id === user && (!conversation || row.conversation_id === conversation) && (!kind || row.kind === kind));
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
import { loadRecentSuggestionStates, saveSuggestionState, suggestionRecallContext } from "./suggestion-state";
beforeEach(() => { db.rows = []; db.conversations = ["c", "c2"]; });

it("recalls a past suggestion across conversations, so a brand new chat can answer \"which product did you suggest\" (found live, R47: this had no persistence at all before, unlike an ordinary place search)", async () => {
  const state = { subject: "strawberry skin treatments", topPick: "First Aid Beauty KP Bump Eraser Body Scrub", alternatives: ["CeraVe SA Cream", "Skinfix KP+ Smoothing Treatment"], updatedAt: Date.now() - 86400000 };
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "suggestion_results", payload_ciphertext: JSON.stringify(state), created_at: "" },
    { id: "r2", user_id: "other", conversation_id: "c", kind: "suggestion_results", payload_ciphertext: JSON.stringify({ ...state, topPick: "Private other user" }), created_at: "" },
  ];
  const records = await loadRecentSuggestionStates("u");
  expect(records).toEqual([state]);
  expect(suggestionRecallContext(records)).toContain("historical data");
  expect(suggestionRecallContext(records)).not.toContain("Private other user");
});

it("ignores corrupt or expired records without inventing memories", async () => {
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "suggestion_results", payload_ciphertext: "broken", created_at: "" },
    { id: "r2", user_id: "u", conversation_id: "c", kind: "suggestion_results", payload_ciphertext: JSON.stringify({ updatedAt: Date.now() - 31 * 86400000, topPick: "Old", subject: "x", alternatives: [] }), created_at: "" },
  ];
  expect(await loadRecentSuggestionStates("u")).toEqual([]);
});

it("a second suggestion in the same conversation never pushes the first out of cross-chat recall (each suggestion is its own row)", async () => {
  await saveSuggestionState("u", "c", { subject: "strawberry skin treatments", topPick: "First Aid Beauty KP Bump Eraser Body Scrub", alternatives: ["CeraVe SA Cream"] });
  await saveSuggestionState("u", "c", { subject: "men's fleece jackets", topPick: "Cotopaxi Abrazo", alternatives: [] });
  const records = await loadRecentSuggestionStates("u");
  expect(records.map((r) => r.subject)).toEqual(["men's fleece jackets", "strawberry skin treatments"]);
});

it("saves nothing for an empty top pick, so a failed suggestion cannot look like a real, empty recommendation", async () => {
  await saveSuggestionState("u", "c", { subject: "strawberry skin treatments", topPick: "", alternatives: [] });
  expect(await loadRecentSuggestionStates("u")).toEqual([]);
});

it("says nothing when there is nothing saved, rather than an empty record block", () => {
  expect(suggestionRecallContext([])).toBe("");
});
