import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Supabase query builder: every method returns the builder, and awaiting it gives the next queued result for that table.
const state = vi.hoisted(() => ({ rpc: vi.fn(), queues: {} as Record<string, unknown[]>, inserts: [] as Array<{ table: string; row: unknown }> }));
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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: builder, rpc: state.rpc }) }));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (value: string) => `enc(${value})`, decryptText: (value: string) => value.replace(/^enc\((.*)\)$/, "$1") }));
vi.mock("@/lib/security/pii-hmac", () => ({ piiHmac: (value: string) => `h(${value})` }));

import { previewDuplicate, createTransactionCandidate } from "./transactions";

const candidate = { occurredOn: "2026-09-15", amountMinor: 3553, currency: "USD", direction: "expense" as const, merchant: "iHerb", category: "shopping" };
const row = { id: "t1", occurred_on: "2026-09-15", amount_minor: 3553, currency: "USD", direction: "expense", merchant_ciphertext: "enc(iHerb)", category: "shopping", note_ciphertext: null };

beforeEach(() => { state.queues = {}; state.inserts = []; state.rpc.mockReset().mockResolvedValue({data: {transaction: row, duplicate: false}, error: null}); });

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
it("matches an order's evidence before date-based similarity", async () => {
 state.queues.finance_transaction_sources = [{data: null}, {data: [{transaction_id: "t1"}]}];
 state.queues.finance_transactions = [{data: row}];
 expect((await previewDuplicate("u1", candidate, {type: "email", externalRef: "new-mail", orderId: "order-1"}))?.duplicateKind).toBe("order");
 expect(state.inserts).toEqual([]);
});
it("does not use an order match with a conflicting amount", async () => {
 state.queues.finance_transaction_sources = [{data: null}, {data: [{transaction_id: "t1"}]}];
 state.queues.finance_transactions = [{data: {...row, amount_minor: 100}}, {data: null}, {data: []}];
 expect(await previewDuplicate("u1", candidate, {type: "email", externalRef: "new-mail", orderId: "order-1"})).toBeNull();
});
it("keeps two explicit order numbers separate even with the same merchant, amount and date", async () => {
 state.queues.finance_transaction_sources = [{data: null}, {data: []}, {data: [{transaction_id: "t1", order_ref_hmac: "different-explicit-order"}]}];
 state.queues.finance_transactions = [{data: null}, {data: [row]}];
 expect(await previewDuplicate("u1", candidate, {type: "email", externalRef: "new-mail", orderId: "second-order"})).toBeNull();
});
it("does not choose one of multiple same-amount nearby purchases arbitrarily", async () => {
 state.queues.finance_transactions = [{data: null}, {data: [row, {...row, id: "t2"}]}];
 expect(await previewDuplicate("u1", candidate)).toBeNull();
});

it("atomically inserts the encrypted transaction and its source in one RPC", async () => {
 await createTransactionCandidate("u1", candidate, {type: "email", externalRef: "new-mail", orderId: "order-a", payload: "private evidence"});
 expect(state.rpc).toHaveBeenCalledTimes(1);
 expect(state.rpc.mock.calls[0][0]).toBe("insert_finance_transaction_with_source");
 expect(state.rpc.mock.calls[0][1]).toMatchObject({p_user_id: "u1", p_transaction: {merchant_ciphertext: "enc(iHerb)"}, p_source: {external_ref_hmac: "h(new-mail)", payload_ciphertext: "enc(private evidence)"}});
 expect(state.inserts).toEqual([]);
});
it("recovers the winning source after an atomic concurrent-source conflict", async () => {
 state.rpc.mockResolvedValue({error: {code: "23505"}});
 state.queues.finance_transaction_sources = [{data: null}, {data: {transaction_id: "t1"}}];
 state.queues.finance_transactions = [{data: null}, {data: []}, {data: row}];
 expect(await createTransactionCandidate("u1", candidate, {type: "email", externalRef: "same-mail"})).toMatchObject({duplicate: true, duplicateKind: "source"});
 expect(state.rpc).toHaveBeenCalledTimes(1);
});

it("reads every page instead of silently dropping transactions after 1000",async()=>{
 const {listTransactions}=await import("./transactions");
 state.queues.finance_transactions=[{data:Array.from({length:1000},(_,n)=>({...row,id:`t${n}`})),error:null},{data:[{...row,id:"last"}],error:null}];
 const result=await listTransactions("u","2026-08-01","2026-09-30");
 expect(result).toHaveLength(1001);expect(result.at(-1)?.id).toBe("last");
});
