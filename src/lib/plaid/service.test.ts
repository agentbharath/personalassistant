import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectBankSync } from "./service";
import { PlaidError, type plaidRequest } from "./client";

const transaction = { transaction_id: "pending", account_id: "a", amount: 10, iso_currency_code: "USD", date: "2026-09-20", pending: true, name: "Shop" };
const page = (extra = {}) => ({ added: [], modified: [], removed: [], accounts: [], next_cursor: "done", has_more: false, ...extra });
beforeEach(() => vi.restoreAllMocks());
describe("bank sync checkpoints", () => {
  it("collects all pages before handing data to persistence", async () => {
    const request = vi.fn().mockResolvedValueOnce(page({ added: [transaction], next_cursor: "page2", has_more: true }))
      .mockResolvedValueOnce(page({ modified: [{ ...transaction, amount: 11 }] }));
    const result = await collectBankSync("secret", "start", "sandbox", request as typeof plaidRequest);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(11);
    expect(request.mock.calls[1][1].cursor).toBe("page2");
    expect(result.cursor).toBe("done");
  });
  it("restarts pagination from the original cursor after provider mutation", async () => {
    const request = vi.fn().mockResolvedValueOnce(page({ added: [transaction], next_cursor: "bad", has_more: true }))
      .mockRejectedValueOnce(new PlaidError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"))
      .mockResolvedValueOnce(page({ added: [{ ...transaction, transaction_id: "posted", pending: false }] }));
    const result = await collectBankSync("secret", "start", "sandbox", request as typeof plaidRequest);
    expect(request.mock.calls[2][1].cursor).toBe("start");
    expect(result.transactions.map(t => t.transaction_id)).toEqual(["posted"]);
  });
  it("does not keep a removed pending transaction alongside its posted replacement", async () => {
    const request = vi.fn().mockResolvedValueOnce(page({ added: [transaction], has_more: true }))
      .mockResolvedValueOnce(page({ removed: [{ transaction_id: "pending" }], added: [{ ...transaction, transaction_id: "posted", pending: false }] }));
    const result = await collectBankSync("secret", undefined, "sandbox", request as typeof plaidRequest);
    expect(result.transactions.map(t => t.transaction_id)).toEqual(["posted"]);
    expect(result.removed).toEqual(["pending"]);
  });
  it("returns no partial result after a later page fails", async () => {
    const request = vi.fn().mockResolvedValueOnce(page({ added: [transaction], has_more: true })).mockRejectedValueOnce(new PlaidError("ITEM_LOGIN_REQUIRED"));
    await expect(collectBankSync("secret", "start", "sandbox", request as typeof plaidRequest)).rejects.toThrow("ITEM_LOGIN_REQUIRED");
  });
});
