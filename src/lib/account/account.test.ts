import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as string[],
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  deletedUser: null as string | null,
  fetches: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      delete: () => ({ eq: async (_column: string, value: string) => { db.calls.push(`delete:${table}:${value}`); return { error: null }; } }),
      select: () => {
        const query = { eq: () => query, order: () => query, range: async () => ({ data: db.rows[table] ?? [], error: null }), then: (resolve: (value: unknown) => void) => resolve({ data: db.rows[table] ?? [], error: null }) };
        return query;
      },
    }),
    auth: { admin: { deleteUser: async (id: string) => { db.deletedUser = id; db.calls.push(`deleteUser:${id}`); return { error: null }; } } },
  }),
}));

process.env.APP_ENCRYPTION_KEY = "test-key-for-account-tests";
import { encryptText } from "@/lib/security/encryption";
import { deleteAccount, deleteSpendingData } from "./delete";
import { buildAccountExport } from "./export";

beforeEach(() => {
  db.calls = []; db.rows = {}; db.deletedUser = null; db.fetches = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { db.fetches.push(String(url)); return new Response(null, { status: 200 }); }));
});

describe("deleting spending records", () => {
  it("removes bills and sources before the transactions they point at, and touches nothing else", async () => {
    await deleteSpendingData("u1");
    expect(db.calls).toEqual(["delete:finance_bills:u1", "delete:finance_transaction_sources:u1", "delete:finance_transactions:u1"]);
  });
});

describe("deleting the account", () => {
  it("deletes children before parents, then the sign-in account last, and revokes Google access", async () => {
    db.rows.oauth_connections = [{ access_token_ciphertext: encryptText("access-token"), refresh_token_ciphertext: encryptText("refresh-token") }];
    await deleteAccount("u1");
    const order = db.calls.map((call) => call.split(":")[1] ?? call);
    const at = (name: string) => order.indexOf(name);
    expect(at("approvals")).toBeLessThan(at("workflow_checkpoints"));
    expect(at("workflow_checkpoints")).toBeLessThan(at("conversations"));
    expect(at("conversation_messages")).toBeLessThan(at("conversations"));
    expect(at("finance_bills")).toBeLessThan(at("finance_transactions"));
    expect(at("finance_transaction_sources")).toBeLessThan(at("finance_transactions"));
    expect(db.calls.at(-1)).toBe("deleteUser:u1");
    expect(db.deletedUser).toBe("u1");
    expect(db.fetches.filter((url) => url.includes("oauth2.googleapis.com/revoke"))).toHaveLength(2);
  });

  it("still deletes the account when Google cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    db.rows.oauth_connections = [{ access_token_ciphertext: encryptText("t"), refresh_token_ciphertext: null }];
    await deleteAccount("u1");
    expect(db.deletedUser).toBe("u1");
  });
});

describe("exporting the user's data", () => {
  it("returns readable chats, spending and preferences, and never any token", async () => {
    db.rows.conversations = [{ id: "c1", title_ciphertext: encryptText("iHerb receipts"), pinned_at: null, created_at: "2026-09-01", updated_at: "2026-09-02" }];
    db.rows.conversation_messages = [
      { conversation_id: "c1", role: "user", content_ciphertext: encryptText("show my receipts"), sequence_number: 1, created_at: "2026-09-01" },
      { conversation_id: "c1", role: "assistant", content_ciphertext: encryptText("Here they are"), sequence_number: 2, created_at: "2026-09-01" },
    ];
    db.rows.finance_transactions = [{ id: "t1", occurred_on: "2026-08-14", amount_minor: 3299, currency: "USD", direction: "expense", merchant_ciphertext: encryptText("iHerb"), category: "Health", note_ciphertext: null, created_at: "x" }];
    db.rows.finance_transaction_sources = [{ transaction_id: "t1", source_type: "email", created_at: "x" }];
    db.rows.user_learnings = [{ kind: "default_action", value_ciphertext: encryptText(JSON.stringify({ kind: "default_action", topic: "receipt", action: "amounts" })), created_at: "x", updated_at: "x" }];
    db.rows.oauth_connections = [{ capability: "email", scopes: ["gmail.readonly"], created_at: "x", updated_at: "x", access_token_ciphertext: "SECRET", refresh_token_ciphertext: "SECRET" }];

    const result = await buildAccountExport("u1", "me@example.com");
    expect(result.account.email).toBe("me@example.com");
    expect(result.conversations[0]).toMatchObject({ title: "iHerb receipts", messages: [{ role: "user", content: "show my receipts" }, { role: "assistant", content: "Here they are" }] });
    expect(result.spending[0]).toMatchObject({ merchant: "iHerb", amount: 32.99, category: "Health", sources: ["email"] });
    expect(result.learnedPreferences[0]).toMatchObject({ kind: "default_action", action: "amounts" });
    expect(result.connections[0]).toEqual({ service: "email", permissions: ["gmail.readonly"], connectedAt: "x" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("keeps going when one value cannot be decrypted", async () => {
    db.rows.conversations = [{ id: "c1", title_ciphertext: "not-encrypted", pinned_at: null, created_at: "x", updated_at: "x" }];
    const result = await buildAccountExport("u1", null);
    expect(result.conversations[0].title).toBeNull();
  });
});
