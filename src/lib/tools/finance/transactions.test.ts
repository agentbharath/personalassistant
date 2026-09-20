import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Supabase query builder: every method returns the builder, and awaiting it gives the next queued result for that table.
const state = vi.hoisted(() => ({ queues: {} as Record<string, unknown[]>, inserts: [] as Array<{ table: string; row: unknown }> }));
function builder(table: string) {
  const proxy: unknown = new Proxy({}, {
    get(_target, key) {
      if (key === "then") return (resolve: (value: unknown) => void) => resolve(state.queues[table]?.shift() ?? { data: null, error: null });
      if (key === "insert") return (row: unknown) => { state.inserts.push({ table, row }); return proxy; };
      return () => proxy;
    },
  });
  return proxy;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: builder }) }));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (value: string) => `enc(${value})`, decryptText: (value: string) => value.replace(/^enc\((.*)\)$/, "$1") }));
vi.mock("@/lib/security/pii-hmac", () => ({ piiHmac: (value: string) => `h(${value})` }));

import { previewDuplicate } from "./transactions";

const candidate = { occurredOn: "2026-09-15", amountMinor: 3553, currency: "USD", direction: "expense" as const, merchant: "iHerb", category: "shopping" };
const row = { id: "t1", occurred_on: "2026-09-15", amount_minor: 3553, currency: "USD", direction: "expense", merchant_ciphertext: "enc(iHerb)", category: "shopping", note_ciphertext: null };

beforeEach(() => { state.queues = {}; state.inserts = []; });

describe("is this purchase already recorded? (free, fake database)", () => {
  it("finds it through the email it came from", async () => {
    state.queues.finance_transaction_sources = [{ data: { transaction_id: "t1" }, error: null }];
    state.queues.finance_transactions = [{ data: row, error: null }];
    const hit = await previewDuplicate("u1", candidate, { type: "email", externalRef: "msg-1" });
    expect(hit?.duplicateKind).toBe("source");
    expect(hit?.transaction.merchant).toBe("iHerb");
  });

  it("finds an identical record", async () => {
    state.queues.finance_transactions = [{ data: row, error: null }];
    expect((await previewDuplicate("u1", candidate))?.duplicateKind).toBe("exact");
  });

  it("finds the same merchant and amount on a nearby date", async () => {
    state.queues.finance_transactions = [{ data: null, error: null }, { data: [row], error: null }];
    expect((await previewDuplicate("u1", candidate))?.duplicateKind).toBe("probable");
  });

  it("does not treat a different merchant with the same amount as a match", async () => {
    state.queues.finance_transactions = [{ data: null, error: null }, { data: [{ ...row, merchant_ciphertext: "enc(Costco)" }], error: null }];
    expect(await previewDuplicate("u1", candidate)).toBeNull();
  });

  it("finds nothing for a new purchase, and never writes anything", async () => {
    expect(await previewDuplicate("u1", candidate, { type: "email", externalRef: "msg-2" })).toBeNull();
    expect(state.inserts).toEqual([]);
  });
});
