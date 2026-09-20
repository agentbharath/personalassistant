import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: null as unknown, updates: [] as unknown[], refresh: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.row, error: null }) }) }) }) }),
      update: (values: unknown) => { mocks.updates.push(values); return { eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }; },
    }),
  }),
}));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (value: string) => `enc(${value})`, decryptText: (value: string) => value.replace(/^enc\((.*)\)$/, "$1") }));

import { GoogleConnectionRequiredError, withGoogleCredential } from "./google-credential-broker";

class Rejected extends Error { reason = "insufficient_scope"; }
const fresh = () => new Date(Date.now() + 30 * 60_000).toISOString();

beforeEach(() => {
  mocks.updates = [];
  mocks.row = { access_token_ciphertext: "enc(old)", refresh_token_ciphertext: "enc(refresh)", access_token_expires_at: fresh(), scopes: ["https://www.googleapis.com/auth/calendar.events"] };
  mocks.refresh.mockReset();
  vi.stubGlobal("fetch", async (...args: unknown[]) => { mocks.refresh(...args); return { ok: true, json: async () => ({ access_token: "new" }) }; });
  process.env.GOOGLE_CLIENT_ID = "id"; process.env.GOOGLE_CLIENT_SECRET = "secret";
});

describe("Google access tokens that Google rejects before they expire (free)", () => {
  it("renews the token once and retries, so the person is not asked to reconnect", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Rejected("401")).mockResolvedValueOnce("events");
    expect(await withGoogleCredential("u1", "calendar", operation)).toBe("events");
    expect(operation.mock.calls.map((call) => call[0])).toEqual(["old", "new"]);
    expect(mocks.updates).toHaveLength(1);
  });

  it("gives up after one renewal when Google still rejects", async () => {
    const operation = vi.fn().mockRejectedValue(new Rejected("401"));
    await expect(withGoogleCredential("u1", "calendar", operation)).rejects.toBeInstanceOf(Rejected);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("asks to reconnect only when there is no refresh token", async () => {
    mocks.row = { ...(mocks.row as object), refresh_token_ciphertext: null };
    await expect(withGoogleCredential("u1", "calendar", vi.fn().mockRejectedValue(new Rejected("401")))).rejects.toBeInstanceOf(GoogleConnectionRequiredError);
  });

  it("does not retry errors that are not a rejected token", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withGoogleCredential("u1", "calendar", operation)).rejects.toThrow("boom");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("still renews an expired token before the first call", async () => {
    mocks.row = { ...(mocks.row as object), access_token_expires_at: new Date(Date.now() - 1000).toISOString() };
    const operation = vi.fn().mockResolvedValue("ok");
    await withGoogleCredential("u1", "calendar", operation);
    expect(operation).toHaveBeenCalledWith("new");
  });
});
