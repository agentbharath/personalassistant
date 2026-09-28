import { afterEach, expect, it, vi } from "vitest";
import { allowedUser, boundedJson } from "./access";
import { contentSecurityPolicy } from "./headers";
afterEach(() => vi.unstubAllEnvs());
it("requires an explicit owner in production and compares whole IDs", () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DAYLARK_ALLOWED_USER_IDS", "");
  expect(allowedUser("owner")).toBe(false);
  vi.stubEnv("DAYLARK_ALLOWED_USER_IDS", "owner, another");
  expect(allowedUser("owner")).toBe(true); expect(allowedUser("own")).toBe(false);
});
it("bounds actual request bytes even without a content length", async () => {
  const request = new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "a".repeat(9000) }) });
  await expect(boundedJson(request)).rejects.toThrow("INVALID_REQUEST");
  await expect(boundedJson(new Request("https://example.test", { method: "POST", body: "{}" }))).rejects.toThrow();
});
it("blocks inline script execution, framing and object embeds in production", () => {
  const policy = contentSecurityPolicy("unique-nonce", false);
  const script = policy.split(";").find(p => p.trim().startsWith("script-src"));
  expect(script).toContain("'nonce-unique-nonce'"); expect(script).not.toContain("unsafe-inline"); expect(script).not.toContain("unsafe-eval");
  expect(policy).toContain("frame-ancestors 'none'"); expect(policy).toContain("object-src 'none'");
});
