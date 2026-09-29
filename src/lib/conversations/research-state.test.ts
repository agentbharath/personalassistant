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
import { loadRecentResearchStates, researchRecallContext, saveResearchState } from "./research-state";
beforeEach(() => { db.rows = []; db.conversations = ["c", "c2"]; });

it("recalls a past comparison across conversations, so a brand new chat can answer \"which air purifier did you recommend\" (found live, R47: this had no persistence at all before, unlike an ordinary place search)", async () => {
  const state = { subject: "air purifiers", recommendation: "Go with the Levoit Core 600S.", options: ["Coway Airmega 400", "Levoit Core 600S"], updatedAt: Date.now() - 86400000 };
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "research_results", payload_ciphertext: JSON.stringify(state), created_at: "" },
    { id: "r2", user_id: "other", conversation_id: "c", kind: "research_results", payload_ciphertext: JSON.stringify({ ...state, recommendation: "Private other user" }), created_at: "" },
  ];
  const records = await loadRecentResearchStates("u");
  expect(records).toEqual([state]);
  expect(researchRecallContext(records)).toContain("historical data");
  expect(researchRecallContext(records)).not.toContain("Private other user");
});

it("ignores corrupt or expired records without inventing memories", async () => {
  db.rows = [
    { id: "r1", user_id: "u", conversation_id: "c", kind: "research_results", payload_ciphertext: "broken", created_at: "" },
    { id: "r2", user_id: "u", conversation_id: "c", kind: "research_results", payload_ciphertext: JSON.stringify({ updatedAt: Date.now() - 31 * 86400000, recommendation: "Old", subject: "x", options: [] }), created_at: "" },
  ];
  expect(await loadRecentResearchStates("u")).toEqual([]);
});

it("a second comparison in the same conversation never pushes the first out of cross-chat recall (each comparison is its own row)", async () => {
  await saveResearchState("u", "c", { subject: "air purifiers", recommendation: "Go with the Levoit Core 600S.", options: ["Coway Airmega 400", "Levoit Core 600S"] });
  await saveResearchState("u", "c", { subject: "budget laptops", recommendation: "Go with the MacBook Neo.", options: [] });
  const records = await loadRecentResearchStates("u");
  expect(records.map((r) => r.subject)).toEqual(["budget laptops", "air purifiers"]);
});

it("saves nothing for an empty recommendation, so a failed comparison cannot look like a real, empty suggestion", async () => {
  await saveResearchState("u", "c", { subject: "air purifiers", recommendation: "", options: [] });
  expect(await loadRecentResearchStates("u")).toEqual([]);
});

it("says nothing when there is nothing saved, rather than an empty record block", () => {
  expect(researchRecallContext([])).toBe("");
});
