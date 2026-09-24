import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({claim: vi.fn(), update: vi.fn(), build: vi.fn(), send: vi.fn(), date: vi.fn(), config: vi.fn()}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({from: () => ({insert: mocks.claim, update: (value: unknown) => {mocks.update(value); const q = {eq: () => q, then: (resolve: (v: unknown) => unknown) => Promise.resolve({error: null}).then(resolve)}; return q;}})})}));
vi.mock("@/lib/today/summary", () => ({buildDaySummary: mocks.build}));
vi.mock("@/lib/replies/dismissals", () => ({isPerchEnabled: async () => true}));
vi.mock("./whatsapp", () => ({whatsappConfig: mocks.config, digestDate: mocks.date, digestParameters: () => ["a", "b", "c", "d"], sendDigest: mocks.send, DigestRejected: class extends Error {}}));
import { runMorningDigest } from "./run";
beforeEach(() => {
 Object.values(mocks).forEach(m => m.mockReset()); mocks.config.mockReturnValue({userId: "u", origin: "https://example.com"}); mocks.date.mockReturnValue("2026-09-22"); mocks.claim.mockResolvedValue({error: null}); mocks.build.mockResolvedValue({}); mocks.send.mockResolvedValue("message-id");
});
it("does not send twice when another invocation already claimed the date", async () => {
 mocks.claim.mockResolvedValue({error: {code: "23505"}});
 expect(await runMorningDigest()).toEqual({status: "already_claimed"}); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
});
it("does not read any personal data outside the scheduled hour", async () => {
 mocks.date.mockReturnValue(null); expect(await runMorningDigest()).toEqual({status: "skipped"}); expect(mocks.build).not.toHaveBeenCalled();
});
it("records accepted delivery without storing its body", async () => {
 expect(await runMorningDigest()).toEqual({status: "sent"}); expect(mocks.update).toHaveBeenCalledWith({status: "sent", provider_message_id: "message-id"});
});
it("retains an unknown delivery state after timeout, preventing a duplicate retry", async () => {
 mocks.send.mockRejectedValue(new Error("timeout")); expect(await runMorningDigest()).toEqual({status: "unknown"}); expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.update).toHaveBeenCalledWith({status: "unknown"});
});
