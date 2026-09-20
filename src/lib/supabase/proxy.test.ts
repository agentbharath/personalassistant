import { describe, expect, it } from "vitest";
import { accessDecision } from "./proxy";

describe("who may open what", () => {
  it("sends a signed-out visitor to sign in for every app page", () => {
    for (const path of ["/", "/history", "/settings", "/anything"]) expect(accessDecision(path, false, false)).toBe("login");
  });

  it("answers a signed-out API request with 401 JSON instead of a redirect", () => {
    for (const path of ["/api/chat", "/api/conversations", "/api/account/export", "/api/finance/receipt-preview"]) expect(accessDecision(path, false, false)).toBe("unauthorized");
  });

  it("keeps sign-in, legal pages, the auth callback, health check, monitoring and the manifest public", () => {
    for (const path of ["/login", "/privacy", "/terms", "/auth/callback", "/api/health", "/api/ops/slo", "/manifest.webmanifest"]) expect(accessDecision(path, false, false)).toBe("allow");
  });

  it("serves the design pages only in development", () => {
    expect(accessDecision("/design", false, true)).toBe("allow");
    expect(accessDecision("/design/app", false, true)).toBe("allow");
    expect(accessDecision("/design", false, false)).toBe("login");
  });

  it("lets a signed-in visitor through, and moves them off the login page", () => {
    expect(accessDecision("/", true, false)).toBe("allow");
    expect(accessDecision("/api/chat", true, false)).toBe("allow");
    expect(accessDecision("/login", true, false)).toBe("home");
  });
});
