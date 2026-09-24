import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/finance-sync/runner", () => ({advanceFinanceSync: vi.fn()}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: vi.fn(() => {throw new Error("Should not access DB");})}));
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("rejects cron calls without the secret before touching any account data", async () => {
 vi.stubEnv("CRON_SECRET", "expected");
 expect((await GET(new Request("https://example.com/api/ops/finance-sync"))).status).toBe(401);
});
it("stays disabled until migration and scheduling setup are complete", async () => {
 vi.stubEnv("CRON_SECRET", "expected"); vi.stubEnv("FINANCE_SYNC_ENABLED", "false");
 const response = await GET(new Request("https://example.com/api/ops/finance-sync", {headers: {authorization: "Bearer expected"}}));
 expect(await response.json()).toEqual({status: "disabled"});
});
