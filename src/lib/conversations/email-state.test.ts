import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ ciphertext: null as string | null, refs: [] as Record<string, unknown>[], fail: false }));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (s: string) => `encrypted:${s}`, decryptText: (s: string) => s.replace(/^encrypted:/, "") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
 let patch: Record<string, unknown> | undefined, record: Record<string, unknown> | undefined;
 const q = { select: () => q, eq: () => q, update: (value: Record<string, unknown>) => { patch = value; return q; }, insert: (value: Record<string, unknown>) => { record = value; return q; },
 maybeSingle: async () => ({ data: { id: "chat", email_state_ciphertext: db.ciphertext } }),
 single: async () => { if (db.fail) return { error: new Error("unavailable") }; db.refs.push(record!); return { data: {id: `ref-${db.refs.length}`} }; },
 then: (resolve: (v: unknown) => unknown) => { if (table === "conversations" && patch) db.ciphertext = String(patch.email_state_ciphertext); return Promise.resolve({error: null}).then(resolve); } };
 return q;
} }) }));
import { loadEmailState, saveEmailState, type EmailState } from "./email-state";
import { withRequestContext, type RequestContext } from "@/lib/runtime/request-context";
const state = (id: string): EmailState => ({request: {action: "list", topic: "general", sender: null, days: 30, calendar: null, unread: false, humansOnly: false, exclusion: ""}, results: [{id, subject: id, from: "sender", date: "2026-01-01"}], updatedAt: 1});
beforeEach(() => { db.ciphertext = null; db.refs = []; db.fail = false; });
it("retains email identities after months without extending approval lifetime", async () => {
 db.ciphertext = `encrypted:${JSON.stringify(state("old-email"))}`;
 expect(await loadEmailState("user", "chat")).toEqual(state("old-email"));
});
it("archives the legacy list before replacing it and preserves both subsequent lists", async () => {
 db.ciphertext = `encrypted:${JSON.stringify(state("legacy"))}`;
 await saveEmailState("user", "chat", state("next"));
 await saveEmailState("user", "chat", state("latest"));
 expect(db.refs).toHaveLength(3);
 expect(db.refs.map(ref => JSON.parse(String(ref.payload_ciphertext).slice(10)).results[0].id)).toEqual(["legacy", "next", "latest"]);
 expect(db.refs.every(ref => ref.user_id === "user" && ref.conversation_id === "chat" && String(ref.payload_ciphertext).startsWith("encrypted:"))).toBe(true);
 expect((await loadEmailState("user", "chat"))?.referenceId).toBe("ref-3");
});
it("keeps previous references and flags a failed archive instead of silently losing them", async () => {
 db.ciphertext = `encrypted:${JSON.stringify(state("legacy"))}`;
 db.fail = true;
 const context: RequestContext = {userId: "user", requestId: "request"};
 await withRequestContext(context, () => saveEmailState("user", "chat", state("next")));
 expect(context.contextPersistenceFailed).toBe(true);
 expect((await loadEmailState("user", "chat"))?.results[0].id).toBe("legacy");
});
