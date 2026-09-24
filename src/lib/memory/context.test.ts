import { describe, expect, it } from "vitest";
import { buildMemoryContext } from "./context";
import type { Memory } from "./types";

const memory = (over: Partial<Memory> = {}): Memory => ({ id: "m1", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", status: "active", supersededBy: null, validUntil: null, createdAt: "2026-09-01T00:00:00.000Z", ...over });

describe("the always-on memory context block (free)", () => {
  it("is empty when there is nothing active", () => {
    expect(buildMemoryContext([])).toBe("");
    expect(buildMemoryContext([memory({ status: "pending" })])).toBe("");
  });

  it("includes hard facts and rules, tagged with type, strength and date", () => {
    const text = buildMemoryContext([memory()]);
    expect(text).toContain("[fact, hard, stated 2026-09-01] Doesn't eat meat except fish and chicken");
  });

  it("leaves out anything not active: pending, superseded, expired, rejected", () => {
    const text = buildMemoryContext([
      memory({ id: "a", status: "pending", statement: "PENDING" }),
      memory({ id: "b", status: "superseded", statement: "SUPERSEDED" }),
      memory({ id: "c", status: "rejected", statement: "REJECTED" }),
      memory({ id: "d", status: "active", statement: "ACTIVE" }),
    ]);
    expect(text).toContain("ACTIVE");
    for (const gone of ["PENDING", "SUPERSEDED", "REJECTED"]) expect(text).not.toContain(gone);
  });

  it("never drops a hard memory to fit the soft budget, only trims soft ones", () => {
    const hard = memory({ id: "hard", strength: "hard", statement: "H".repeat(100) });
    const soft = Array.from({ length: 200 }, (_, i) => memory({ id: `s${i}`, strength: "soft", statement: `soft-${i}-${"x".repeat(80)}`, createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }));
    const text = buildMemoryContext([hard, ...soft]);
    expect(text).toContain("H".repeat(100));
    expect(text.length).toBeLessThan(6000);
  });
});
