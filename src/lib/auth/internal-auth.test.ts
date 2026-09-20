import { describe, expect, it } from "vitest";
import { hasValidInternalBearer } from "./internal-auth";

describe("internal bearer authentication", () => {
  it("accepts only an exact bearer secret", () => {
    expect(hasValidInternalBearer(new Request("http://localhost", { headers: { authorization: "Bearer correct" } }), "correct")).toBe(true);
    expect(hasValidInternalBearer(new Request("http://localhost", { headers: { authorization: "Bearer wrong" } }), "correct")).toBe(false);
    expect(hasValidInternalBearer(new Request("http://localhost"), "correct")).toBe(false);
  });
});
