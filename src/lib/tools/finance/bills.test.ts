import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queue: [] as unknown[], inserts: [] as Record<string, unknown>[], ranges: [] as number[][], transactions: vi.fn() }));
function builder() {
  const proxy: unknown = new Proxy({}, { get(_target, key) {
    if (key === "then") return (resolve: (value: unknown) => void) => resolve(state.queue.shift() ?? { data: [], error: null });
    if (key === "insert") return (value: Record<string, unknown>) => { state.inserts.push(value); return proxy; };
    if (key === "range") return (...range: number[]) => { state.ranges.push(range); return proxy; };
    return () => proxy;
  } });
  return proxy;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: builder }) }));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (value: string) => value, decryptText: (value: string) => value }));
vi.mock("@/lib/security/pii-hmac", () => ({ piiHmac: (value: string) => value }));
vi.mock("./transactions", () => ({ createTransactionCandidate: state.transactions }));
import { createBill, listBills, settleBill } from "./bills";
const row = (over = {}) => ({ id: "b", merchant_ciphertext: "Local Bank", amount_minor: 10000, currency: "USD", category: "other", statement_date: "2026-09-01", due_date: "2026-10-05", status: "outstanding", paid_on: null, payload_ciphertext: JSON.stringify({ paymentDirection: "transfer", accountLastFour: "1234" }), ...over });
beforeEach(() => { state.queue = []; state.inserts = []; state.ranges = []; state.transactions.mockReset().mockResolvedValue({ transaction: { id: "t" }, duplicate: false }); });

describe("saved dues", () => {
  it("reads all pages instead of silently stopping at 200 bills", async () => {
    state.queue = [{ data: Array.from({ length: 500 }, (_, i) => row({ id: String(i) })), error: null }, { data: [row({ id: "last" })], error: null }];
    expect(await listBills("u")).toHaveLength(501);
    expect(state.ranges).toEqual([[0, 499], [500, 999]]);
  });
  it("does not return a partial list if a later database page fails", async () => {
    state.queue = [{ data: Array.from({ length: 500 }, () => row()), error: null }, { data: null, error: new Error("down") }];
    await expect(listBills("u")).rejects.toThrow("down");
  });
  it("hides older balances of a card when its latest statement was paid, without hiding other accounts", async () => {
    state.queue = [{ data: [row({ id: "older", statement_date: "2026-08-01" }), row({ id: "paid", status: "paid" }), row({ id: "other", payload_ciphertext: JSON.stringify({ paymentDirection: "transfer", accountLastFour: "5678" }) })], error: null }];
    expect((await listBills("u", "outstanding")).map((bill) => bill.id)).toEqual(["other"]);
  });
  it("preserves old bills whose evidence was plain text", async () => {
    state.queue = [{ data: [row({ payload_ciphertext: "legacy text" })], error: null }];
    expect((await listBills("u"))[0].paymentDirection).toBe("expense");
  });
  it("stores the card classification and account hint in encrypted evidence", async () => {
    state.queue = [{ data: null, error: null }, { data: row(), error: null }];
    await createBill("u", { merchant: "Local Bank", amountMinor: 10000, currency: "USD", category: "other", statementDate: "2026-09-01", dueDate: "2026-10-05", paymentDirection: "transfer", accountLastFour: "1234" });
    expect(JSON.parse(state.inserts[0].payload_ciphertext as string)).toMatchObject({ paymentDirection: "transfer", accountLastFour: "1234" });
    expect(state.inserts[0].dedupe_fingerprint).toContain("1234");
  });
  it("keeps card settlement a transfer even if the caller defaults to expense", async () => {
    state.queue = [{ data: row(), error: null }, { data: row({ status: "paid", paid_on: "2026-09-20" }), error: null }];
    await settleBill("u", "b", "2026-09-20", { type: "user_input" }, "expense");
    expect(state.transactions).toHaveBeenCalledWith("u", expect.objectContaining({ direction: "transfer", amountMinor: 10000 }), expect.anything());
  });
});

it.each([
  { amountMinor: 9900, currency: "USD", accountLastFour: "1234" },
  { amountMinor: 10000, currency: "INR", accountLastFour: "1234" },
  { amountMinor: 10000, currency: "USD", accountLastFour: "5678" },
])("rejects a stale or mismatched approved payment before writing", async payment => {
  state.queue = [{ data: row(), error: null }];
  await expect(settleBill("u", "b", "2026-09-20", { type: "email" }, "transfer", payment)).rejects.toThrow("PAYMENT_DOES_NOT_MATCH_BILL");
  expect(state.transactions).not.toHaveBeenCalled();
});
it("records the exact approved payment", async () => {
  state.queue = [{ data: row(), error: null }, { data: row({ status: "paid" }), error: null }];
  await settleBill("u", "b", "2026-09-20", { type: "email" }, "transfer", { amountMinor: 10000, currency: "USD", accountLastFour: "1234" });
  expect(state.transactions).toHaveBeenCalledWith("u", expect.objectContaining({ amountMinor: 10000, currency: "USD" }), expect.anything());
});
