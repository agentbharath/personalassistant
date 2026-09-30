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
import { conversationAnswerRecallContext, loadRecentConversationAnswerStates, saveConversationAnswerState } from "./conversation-state";
beforeEach(() => { db.rows = []; db.conversations = ["c", "c2"]; });

it("recalls a plain answer across conversations, so a brand new chat can recall a stock quote, a weather check, or any other answer that has no more specific persistence (found live, R47: chasing recall one feature at a time each left a real gap -- 'it doesn't matter which classification, it should remember')", async () => {
  const state = { query: "what's Apple stock at", answer: "### AAPL · Apple Inc\n\n$254.32 +$1.24 (0.49%)", updatedAt: Date.now() - 86400000 };
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "answer_results", payload_ciphertext: JSON.stringify(state), created_at: "" },
    { id: "r2", user_id: "other", conversation_id: "c", kind: "answer_results", payload_ciphertext: JSON.stringify({ ...state, answer: "Private other user" }), created_at: "" },
  ];
  const records = await loadRecentConversationAnswerStates("u");
  expect(records).toEqual([state]);
  expect(conversationAnswerRecallContext(records)).toContain("historical data");
  expect(conversationAnswerRecallContext(records)).not.toContain("Private other user");
});

it("ignores corrupt or expired records without inventing memories", async () => {
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "answer_results", payload_ciphertext: "broken", created_at: "" },
    { id: "r2", user_id: "u", conversation_id: "c", kind: "answer_results", payload_ciphertext: JSON.stringify({ updatedAt: Date.now() - 31 * 86400000, answer: "Old", query: "x" }), created_at: "" },
  ];
  expect(await loadRecentConversationAnswerStates("u")).toEqual([]);
});

it("a second answer in the same conversation never pushes the first out of cross-chat recall (each answer is its own row)", async () => {
  await saveConversationAnswerState("u", "c", { query: "what's Apple stock at", answer: "$254.32" });
  await saveConversationAnswerState("u", "c", { query: "what's the weather", answer: "72°F, sunny" });
  const records = await loadRecentConversationAnswerStates("u");
  expect(records.map((r) => r.query)).toEqual(["what's the weather", "what's Apple stock at"]);
});

it("saves nothing for an empty answer, so a failed turn cannot look like a real, empty answer", async () => {
  await saveConversationAnswerState("u", "c", { query: "x", answer: "" });
  expect(await loadRecentConversationAnswerStates("u")).toEqual([]);
});

it("says nothing when there is nothing saved, rather than an empty record block", () => {
  expect(conversationAnswerRecallContext([])).toBe("");
});

it("keeps enough of a saved answer that a verdict's last row is still recallable (found live: row 4 of a 673-character verdict sat past the old 400-character cut)", () => {
  const answer = "### Verdict on the 4 windbreakers above\n\n" + "x".repeat(450) + "\n\n**North End pullover** $21.81 — Skip: no review evidence";
  const context = conversationAnswerRecallContext([{ query: "are they good?", answer, updatedAt: Date.now() }]);
  expect(context).toContain("North End pullover");
  expect(context).toContain("Skip");
});
