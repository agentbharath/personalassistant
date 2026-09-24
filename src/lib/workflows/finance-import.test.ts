import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({tables: {} as Record<string, unknown[]>, settle: vi.fn(), create: vi.fn()}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({from: (table: string) => {
 const q: unknown = new Proxy({}, {get: (_t, key) => key === "then" ? (resolve: (v: unknown) => unknown) => Promise.resolve(mocks.tables[table]?.shift() ?? {data: null, error: null}).then(resolve) : () => q}); return q;
}})}));
vi.mock("@/lib/security/encryption", () => ({encryptText: (s: string) => s, decryptText: (s: string) => s}));
vi.mock("@/lib/tools/finance/transactions", () => ({createTransactionCandidate: mocks.create}));
vi.mock("@/lib/finance-sync/store", () => ({settleSyncCandidates: mocks.settle}));
vi.mock("./email-scan", () => ({emailScanContinuationNote: async () => ""}));
import { resolvePendingFinanceImport } from "./finance-import";
const item = {candidate: {merchant: "Store", amountMinor: 1000, currency: "USD", occurredOn: "2026-09-20", direction: "expense", category: "shopping"}, source: {type: "email", externalRef: "mail", payload: "{}"}};
beforeEach(() => {
 mocks.create.mockReset().mockResolvedValue({duplicate: false}); mocks.settle.mockReset();
 mocks.tables = {workflow_checkpoints: [{data: [{id: "checkpoint", checkpoint: {validationVersion: 2, payloadCiphertext: JSON.stringify({items: [item], sync: {runId: "run", candidateIds: ["one"]}})}}]}], approvals: [{data: {id: "approval", expires_at: new Date(Date.now() + 60000).toISOString()}}, {data: {id: "approval"}}]};
});
it("marks sync candidates approved only after the ledger write succeeds", async () => {
 const result = await resolvePendingFinanceImport("u", "c", "confirm");
 expect(result?.status).toBe("completed");
 expect(mocks.create).toHaveBeenCalledTimes(1);
 expect(mocks.settle).toHaveBeenCalledWith("u", "run", ["one"], "approved");
 expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.settle.mock.invocationCallOrder[0]);
});
it("rejects a declined batch without writing transactions", async () => {
 await resolvePendingFinanceImport("u", "c", "cancel");
 expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.settle).toHaveBeenCalledWith("u", "run", ["one"], "rejected");
});
it("does not resolve candidates when an approval expires", async () => {
 mocks.tables.approvals = [{data: {id: "approval", expires_at: "2020-01-01"}}];
 expect((await resolvePendingFinanceImport("u", "c", "confirm"))?.answer).toContain("expired");
 expect(mocks.settle).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it("does not advance sync after a failed import", async () => {
 mocks.create.mockRejectedValue(new Error("database unavailable"));
 await expect(resolvePendingFinanceImport("u", "c", "confirm")).rejects.toThrow();
 expect(mocks.settle).not.toHaveBeenCalled();
});
it("does not act after another request has claimed the approval", async () => {
 mocks.tables.approvals[1] = {data: null};
 await resolvePendingFinanceImport("u", "c", "confirm");
 expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
});
