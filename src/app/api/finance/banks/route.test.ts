import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), overview: vi.fn(), link: vi.fn(), exchange: vi.fn(), sync: vi.fn(), disconnect: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.claims } }) }));
vi.mock("@/lib/plaid/service", () => ({ bankOverview: mocks.overview, createBankLink: mocks.link, completeBankLink: mocks.exchange, syncBank: mocks.sync, disconnectBank: mocks.disconnect, importBankRecord: mocks.save }));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.stubEnv("PLAID_ENV", "production"); vi.stubEnv("PLAID_CLIENT_ID", "test"); vi.stubEnv("PLAID_CLIENT_SECRET", "test");
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "signed-in-user" } } });
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
