vi.mock("@/lib/security/rate-limit", () => ({ financialRateLimit: mocks.rate }));
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), rate: vi.fn(), overview: vi.fn(), link: vi.fn(), exchange: vi.fn(), sync: vi.fn(), disconnect: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.claims } }) }));
vi.mock("@/lib/plaid/service", () => ({ bankOverview: mocks.overview, createBankLink: mocks.link, completeBankLink: mocks.exchange, syncBank: mocks.sync, disconnectBank: mocks.disconnect, importBankRecord: mocks.save }));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.stubEnv("PLAID_ENV", "production"); vi.stubEnv("PLAID_CLIENT_ID", "test"); vi.stubEnv("PLAID_CLIENT_SECRET", "test");
  vi.stubEnv("DAYLARK_ALLOWED_USER_IDS", "signed-in-user");
  mocks.rate.mockResolvedValue(true);
  mocks.claims.mockResolvedValue({ data: { user: { id: "signed-in-user" } } });
  mocks.link.mockResolvedValue({ linkToken: "ephemeral", sessionId: id });
  mocks.overview.mockResolvedValue({ items: [] });
  mocks.sync.mockResolvedValue({ changed: 0 });
});
const request = (body: unknown, origin = "https://daylark.test") => new Request("https://daylark.test/api/finance/banks", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
it("requires authentication for reads", async () => {
  mocks.claims.mockResolvedValue({ data: null });
  expect((await GET(new Request("https://daylark.test/api/finance/banks"))).status).toBe(401);
});
it("rejects cross-origin mutations before calling Plaid", async () => {
  expect((await POST(request({ action: "link" }, "https://other.test"))).status).toBe(403);
  expect(mocks.link).not.toHaveBeenCalled();
});
it("derives ownership from the session, never a body user ID", async () => {
  expect((await POST(request({ action: "sync", connectionId: id, userId: "victim" }))).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith("signed-in-user", id);
});
it("requires explicit ongoing-sync approval to save a record", async () => {
  expect((await POST(request({ action: "import", id, hash: "preview" }))).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("keeps sandbox data out of the real ledger", async () => {
  vi.stubEnv("PLAID_ENV", "sandbox");
  expect((await POST(request({ action: "import", id, hash: "preview", keepSynced: true }))).status).toBe(503);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("never returns provider error bodies or credentials", async () => {
  mocks.link.mockRejectedValueOnce(new Error("secret-provider-body"));
  const response = await POST(request({ action: "link" }));
  expect(await response.text()).not.toContain("secret-provider-body");
});
it("blocks a signed-in person outside the private allowlist", async () => {
  mocks.claims.mockResolvedValue({ data: { user: { id: "someone-else" } } });
  expect((await POST(request({ action: "link" }))).status).toBe(401);
  expect(mocks.link).not.toHaveBeenCalled();
});
it("returns 429 before a provider request when a shared budget is exhausted", async () => {
  mocks.rate.mockResolvedValue(false);
  const response = await POST(request({ action: "link" }));
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBeTruthy();
  expect(mocks.link).not.toHaveBeenCalled();
});
it("fails closed when the shared limiter is unavailable", async () => {
  mocks.rate.mockRejectedValue(new Error("database details"));
  const response = await POST(request({ action: "link" }));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("database details");
  expect(mocks.link).not.toHaveBeenCalled();
});
it("rejects an oversized exchange payload before the provider", async () => {
  expect((await POST(request({ action: "exchange", sessionId: id, publicToken: "a".repeat(10000) }))).status).toBe(400);
  expect(mocks.exchange).not.toHaveBeenCalled();
});
