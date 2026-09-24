import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], refs: [] as Record<string, unknown>[], owner: true, fail: false, scopes: [] as string[], pages: 0 }));
vi.mock("@/lib/security/encryption", () => ({ decryptText: (s: string) => s }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let before = Infinity, start = 0, end = 99;
  const q = { select: () => q, eq: (key: string, value: string) => { db.scopes.push(`${table}:${key}:${value}`); return q; }, order: () => q, limit: () => q,
    lt: (_key: string, value: string) => { before = Number(value); return q; }, range: (a: number, b: number) => { start = a; end = b; return q; },
    maybeSingle: async () => ({ data: db.owner ? { id: "chat" } : null }),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => {
      if (db.fail) return Promise.reject(new Error("offline")).then(resolve, reject);
      if (table === "conversation_messages") db.pages++;
      return Promise.resolve({ data: table === "conversation_messages" ? db.rows.filter(row => Number(row.sequence_number) < before).slice(0, 200) : db.refs.slice(start, end + 1) }).then(resolve, reject);
    } };
  return q;
} }) }));
import { recallConversation, selectHistory, type HistoryTurn } from "./history";
beforeEach(() => { db.rows = []; db.refs = []; db.owner = true; db.fail = false; db.scopes = []; db.pages = 0; });
const turn = (content: string, i: number): HistoryTurn => ({ content, role: i % 2 ? "assistant" : "user", sequence: String(i), createdAt: "2026-08-01" });
it.each(["calendar meeting", "resume draft", "restaurant dinner", "personal preference", "unfinished task"])("recalls %s and its adjacent correction", query => {
 const turns = [turn(`We discussed ${query}`, 0), turn("Actually, change that to Tuesday", 1), ...Array.from({length: 30}, (_, i) => turn(`Other unrelated turn ${i}`, i + 2))];
 const result = selectHistory(turns, query, []);
 expect(result.map(t => t.content)).toEqual([`We discussed ${query}`, "Actually, change that to Tuesday"]);
});
it("searches beyond the first page and keeps immutable list identities", async () => {
 db.rows = Array.from({length: 205}, (_, i) => ({ role: "user", sequence_number: 205 - i, created_at: "2026-08-01", content_ciphertext: i === 204 ? "Resume draft for an engineering role" : "unrelated" }));
 db.refs = [{ id: "old-list", kind: "email_results", created_at: "2026-08-01", payload_ciphertext: JSON.stringify({request: {intent: "resume"}, results: [{id: "original-message"}]}) }];
 const result = await recallConversation("user", "chat", "resume", []);
 expect(db.pages).toBe(2);
 expect(result.text).toContain("Resume draft for an engineering role");
 expect(result.references[0].id).toBe("old-list");
 for (const table of ["conversation_messages", "conversation_references"]) {
   expect(db.scopes).toContain(`${table}:user_id:user`);
   expect(db.scopes).toContain(`${table}:conversation_id:chat`);
 }
});
it("does not read another user's or a deleted conversation", async () => {
 db.owner = false;
 const result = await recallConversation("other", "chat", "resume", []);
 expect(result.text).toContain("unavailable");
 expect(result.references).toEqual([]);
 expect(db.pages).toBe(0);
});
it("reports a failed history read as partial without denying past discussion", async () => {
 db.fail = true;
 const result = await recallConversation("user", "chat", "resume", []);
 expect(result.text).toContain("partial");
 expect(result.text).toContain("do not claim omitted details never occurred");
});
