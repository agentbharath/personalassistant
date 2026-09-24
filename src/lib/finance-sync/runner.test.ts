import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({load: vi.fn(), claim: vi.fn(), save: vi.fn(), known: vi.fn(), stage: vi.fn(), candidates: vi.fn(), finish: vi.fn(), search: vi.fn(), recorded: vi.fn(), classify: vi.fn(), extract: vi.fn()}));
vi.mock("./store", () => ({loadSync: mocks.load, claimSync: mocks.claim, decodeCursor: (state: {cursor: unknown}) => state.cursor, saveSync: mocks.save, knownCandidateRefs: mocks.known, stageCandidate: mocks.stage, candidates: mocks.candidates, finishSync: mocks.finish}));
vi.mock("./classifier", () => ({classifyFinancialMail: mocks.classify, isPositive: (kind: string) => ["receipt", "refund", "bill_due", "statement", "transfer"].includes(kind)}));
vi.mock("./extraction", () => ({extractSyncCandidate: mocks.extract}));
vi.mock("@/lib/tools/email/google-gmail", () => ({searchGmailForImport: mocks.search}));
vi.mock("@/lib/tools/finance/transactions", () => ({recordedEmailRefs: mocks.recorded}));
vi.mock("@/lib/security/pii-hmac", () => ({piiHmac: (s: string) => s}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({from: () => {
 const q = {select: () => q, eq: () => q, maybeSingle: async () => ({data: null}), upsert: async () => ({error: null})}; return q;
}})}));
import { advanceFinanceSync } from "./runner";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
const mail = (id: string) => ({id, from: "store@example.com", subject: "Receipt", snippet: "$10.00"});
let state: {user_id: string; run_id: string; cursor: {gmail: {retryAt: number; ready: ReturnType<typeof mail>[]; pending: never[]; stage: number; queries: string[]}; classes: Record<string, string>}};
beforeEach(() => {
 Object.values(mocks).forEach(m => m.mockReset());
 state = {user_id: "u", run_id: "run", cursor: {gmail: {retryAt: 0, ready: [mail("one")], pending: [], stage: 1, queries: ["query"]}, classes: {}}};
 mocks.load.mockResolvedValue(state); mocks.claim.mockResolvedValue(state); mocks.known.mockResolvedValue(new Set()); mocks.recorded.mockResolvedValue(new Set()); mocks.candidates.mockResolvedValue([]); mocks.classify.mockResolvedValue({one: "receipt"}); mocks.extract.mockResolvedValue({candidate: {amountMinor: 1000}});
});
it("stages positives for review and never writes the ledger", async () => {
 await advanceFinanceSync("u");
 expect(mocks.stage).toHaveBeenCalledWith(state, "one", "receipt", {candidate: {amountMinor: 1000}});
 expect(mocks.save).toHaveBeenLastCalledWith(state, state.cursor, "review", null);
 expect(mocks.finish).toHaveBeenCalledWith("u", "run");
});
it("does no work when another worker owns the lease", async () => {
 mocks.claim.mockResolvedValue(null);
 await advanceFinanceSync("u");
 expect(mocks.classify).not.toHaveBeenCalled();
 expect(mocks.save).not.toHaveBeenCalled();
});
it("skips already recorded and rejected candidates before extraction", async () => {
 state.cursor.gmail.ready.push(mail("two")); mocks.recorded.mockResolvedValue(new Set(["one"])); mocks.known.mockResolvedValue(new Set(["two"])); mocks.classify.mockResolvedValue({});
 await advanceFinanceSync("u");
 expect(mocks.classify).toHaveBeenCalledWith("u", []);
 expect(mocks.extract).not.toHaveBeenCalled();
});
it("never extracts shipping updates into transactions", async () => {
 mocks.classify.mockResolvedValue({one: "shipping_update"});
 await advanceFinanceSync("u");
 expect(mocks.extract).not.toHaveBeenCalled();
 expect(mocks.stage).toHaveBeenCalledWith(state, "one", "shipping_update", null);
});
it("retains candidate queue when the model is unavailable", async () => {
 mocks.extract.mockRejectedValue(new Error("MODEL_UNAVAILABLE"));
 await advanceFinanceSync("u");
 expect(state.cursor.gmail.ready).toHaveLength(1);
 expect(mocks.save.mock.calls.at(-1)?.[2]).toBe("queued");
 expect(mocks.finish).not.toHaveBeenCalled();
});
it("keeps the watermark unchanged when grounded evidence is missing", async () => {
 mocks.extract.mockRejectedValue(new Error("EXTRACTION_NEEDS_REVIEW")); mocks.candidates.mockResolvedValue([{id: "blocked"}]);
 await advanceFinanceSync("u");
 expect(mocks.stage).toHaveBeenCalledWith(state, "one", "receipt", null, "blocked", mail("one"));
 expect(mocks.save.mock.calls.at(-1)?.[2]).toBe("blocked");
 expect(mocks.finish).not.toHaveBeenCalled();
});
it("honors Gmail cooldown without reading or spending tokens", async () => {
 state.cursor.gmail.retryAt = Date.now() + 30000;
 await advanceFinanceSync("u");
 expect(mocks.classify).not.toHaveBeenCalled();
 expect(mocks.search).not.toHaveBeenCalled();
});
it("exposes revoked Google access as a reconnect action", async () => {
 mocks.extract.mockRejectedValue(new GoogleConnectionRequiredError("email"));
 await advanceFinanceSync("u");
 expect(mocks.save).toHaveBeenLastCalledWith(state, state.cursor, "blocked", "Reconnect Google");
 expect(mocks.finish).not.toHaveBeenCalled();
});
