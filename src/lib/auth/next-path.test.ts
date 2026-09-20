import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("where to go after sign-in", () => {
  it("keeps a path inside the app, with its query", () => {
    expect(safeNextPath("/history")).toBe("/history");
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/?conversation=abc")).toBe("/?conversation=abc");
    expect(safeNextPath("%2Fhistory")).toBe("/history");
  });

  it("falls back to home when there is nothing to go back to", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("never redirects off-site or to sign-in itself", () => {
    const bad = ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example", "/login", "/login?next=/x", "/auth/callback", "%2F%2Fevil.example", "/a%0Ab"];
    for (const value of bad) expect(safeNextPath(value)).toBe("/");
  });

  it("survives malformed encoding", () => {
    expect(safeNextPath("%E0%A4%A")).toBe("/");
  });
});
