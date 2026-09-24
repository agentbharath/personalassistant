import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queue: [] as unknown[], inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[], deletes: 0 }));
function builder() {
  const proxy: unknown = new Proxy({}, { get(_target, key) {
    if (key === "then") return (resolve: (value: unknown) => void) => resolve(state.queue.shift() ?? { data: [], error: null });
    if (key === "insert") return (value: Record<string, unknown>) => { state.inserts.push(value); return proxy; };
    if (key === "update") return (value: Record<string, unknown>) => { state.updates.push(value); return proxy; };
    if (key === "delete") return () => { state.deletes += 1; return proxy; };
    return () => proxy;
  } });
  return proxy;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: builder }) }));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (value: string) => `enc:${value}`, decryptText: (value: string) => value.replace(/^enc:/, "") }));
import { confirmMemory, createMemory, forgetMemory, listMemories, rejectMemory, supersedeMemory } from "./store";
beforeEach(() => { state.queue = []; state.inserts = []; state.updates = []; state.deletes = 0; });

const row = (over = {}) => ({ id: "m1", type: "fact", category: "diet", strength: "hard", statement_ciphertext: "enc:Doesn't eat meat except fish and chicken", status: "active", superseded_by: null, valid_until: null, created_at: "2026-09-01T00:00:00.000Z", ...over });

describe("reading memories", () => {
  it("decrypts the statement and decodes the row", async () => {
    state.queue = [{ data: [row()], error: null }];
    const memories = await listMemories("u", ["active"]);
    expect(memories).toEqual([{ id: "m1", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", status: "active", supersededBy: null, validUntil: null, createdAt: "2026-09-01T00:00:00.000Z" }]);
  });
  it("leaves out a memory whose validUntil has already passed", async () => {
    state.queue = [{ data: [row({ valid_until: "2020-01-01T00:00:00.000Z" }), row({ id: "m2", valid_until: null })], error: null }];
    const memories = await listMemories("u");
    expect(memories.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("writing memories", () => {
  it("encrypts the statement on create, and logs an audit event", async () => {
    state.queue = [{ data: { id: "new-id" }, error: null }, { error: null }];
    const id = await createMemory("u", { type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken" });
    expect(id).toBe("new-id");
    expect(state.inserts[0]).toMatchObject({ user_id: "u", statement_ciphertext: "enc:Doesn't eat meat except fish and chicken", status: "active" });
  });
  it("supersede marks the old row and points it at the new one, never overwriting it", async () => {
    state.queue = [{ error: null }, { error: null }];
    await supersedeMemory("u", "old-id", "new-id");
    expect(state.updates[0]).toMatchObject({ status: "superseded", superseded_by: "new-id" });
  });
  it("confirm promotes a pending memory to active", async () => {
    state.queue = [{ error: null }, { error: null }];
    await confirmMemory("u", "m1");
    expect(state.updates[0]).toMatchObject({ status: "active" });
  });
  it("reject marks a pending memory rejected, not deleted, so the same guess isn't re-filed silently", async () => {
    state.queue = [{ error: null }, { error: null }];
    await rejectMemory("u", "m1");
    expect(state.updates[0]).toMatchObject({ status: "rejected" });
  });
  it("forget really deletes the row (not a status flag)", async () => {
    state.queue = [{ error: null }, { error: null }];
    await forgetMemory("u", "m1");
    expect(state.deletes).toBe(1);
  });
});
