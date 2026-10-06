import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], refs: [] as Record<string, unknown>[], owner: true, fail: false, scopes: [] as string[], pages: 0 }));
vi.mock("@/lib/security/encryption", () => ({ decryptText: (s: string) => s }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let before = Infinity, start = 0, end = 99;
  const filters: Record<string, string> = {};
  const q = { select: () => q, eq: (key: string, value: string) => { db.scopes.push(`${table}:${key}:${value}`); filters[key] = value; return q; }, order: () => q, limit: () => q,
    lt: (_key: string, value: string) => { before = Number(value); return q; }, range: (a: number, b: number) => { start = a; end = b; return q; },
    maybeSingle: async () => ({ data: db.owner ? { id: "chat" } : null }),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => {
      if (db.fail) return Promise.reject(new Error("offline")).then(resolve, reject);
      if (table === "conversation_messages") { db.pages++; return Promise.resolve({ data: db.rows.filter(row => Number(row.sequence_number) < before).slice(0, 200) }).then(resolve, reject); }
      // Mirrors readReferences: only filters conversation_references by conversation_id when the code under test actually applies that filter.
      const scoped = db.refs.filter(row => !filters.conversation_id || row.conversation_id === filters.conversation_id);
      return Promise.resolve({ data: scoped.slice(start, end + 1) }).then(resolve, reject);
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
 // Messages stay scoped to this one conversation; a saved search result belongs to the person, not the thread it
 // happened in, so references are read across every one of the user's conversations, never someone else's.
 expect(db.scopes).toContain("conversation_messages:user_id:user");
 expect(db.scopes).toContain("conversation_messages:conversation_id:chat");
 expect(db.scopes).toContain("conversation_references:user_id:user");
 expect(db.scopes).not.toContain("conversation_references:conversation_id:chat");
});
it("finds a saved search from a different conversation (found live: a restaurant recommendation from an earlier chat couldn't be recalled from a brand-new one)", async () => {
 db.refs = [{ id: "sushi-search", conversation_id: "an-older-chat", kind: "place_results", created_at: "2026-09-26", payload_ciphertext: JSON.stringify({ query: "best sushi restaurants in Sunnyvale, CA", places: [{ name: "Katana Sushi & Sake" }, { name: "Senro Sunnyvale" }] }) }];
 const result = await recallConversation("user", "brand-new-chat", "restaurant recommendation sushi", []);
 expect(result.references[0]?.id).toBe("sushi-search");
 expect(result.text).toContain("Katana Sushi");
});
it("ranks a real suggestion above Daylark's own wrong echo of the same question (found live: 'out of all the headphones you suggest which was the cheapest?' kept re-finding a prior turn's wrong 'I haven't suggested any headphones' answer instead of the real suggestion card, because that wrong answer's own saved query field is the person's exact words, an unbeatable word-overlap match against itself -- a self-reinforcing loop on every retry)", async () => {
 db.refs = [
   { id: "wrong-echo", kind: "answer_results", created_at: "2026-10-06T20:41:00Z", payload_ciphertext: JSON.stringify({ query: "out of all the headphones you suggest which was the cheapest?", answer: "I haven't suggested any headphones to you in our conversation. The saved search records show restaurant and activity searches, but no headphone recommendations." }) },
   { id: "real-suggestion", kind: "suggestion_results", created_at: "2026-10-06T20:39:03Z", payload_ciphertext: JSON.stringify({ subject: "Noise cancelling headphones under $200", topPick: "Sony WH-CH720N", alternatives: ["JLab JBuds Lux ANC"], options: [{ name: "Sony WH-CH720N", metric: "Under $100", meta: "Rolling Stone, over-ear" }] }) },
 ];
 const result = await recallConversation("user", "chat", "out of all the headphones you suggest which was the cheapest?", []);
 expect(result.references[0]?.id).toBe("real-suggestion");
 expect(result.text).toContain("Sony WH-CH720N");
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
