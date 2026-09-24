import { describe, expect, it } from "vitest";
import { findMatchingMemories, renderMemories } from "./commands";
import type { Memory } from "./types";

const memory = (over: Partial<Memory> = {}): Memory => ({ id: "m1", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", status: "active", supersededBy: null, validUntil: null, createdAt: "2026-09-01T00:00:00.000Z", ...over });

describe("finding what 'forget X' refers to (free)", () => {
  it("matches by a word in the statement, case-insensitively", () => {
    expect(findMatchingMemories([memory()], "meat")).toHaveLength(1);
    expect(findMatchingMemories([memory()], "MEAT")).toHaveLength(1);
  });
  it("matches by category", () => {
    expect(findMatchingMemories([memory()], "diet")).toHaveLength(1);
  });
  it("returns nothing for an empty term or no match, rather than guessing", () => {
    expect(findMatchingMemories([memory()], "")).toEqual([]);
    expect(findMatchingMemories([memory()], "sushi")).toEqual([]);
  });
});

describe("rendering what's remembered (free)", () => {
  it("says plainly when nothing is remembered", () => {
    expect(renderMemories([], [])).toMatch(/haven't remembered anything yet/);
  });
  it("groups active memories by type, and lists pending ones separately", () => {
    const text = renderMemories(
      [memory({ type: "fact" }), memory({ id: "m2", type: "rule", statement: "Always ask before importing transactions" })],
      [memory({ id: "m3", status: "pending", statement: "Likes sushi" })],
    );
    expect(text).toContain("**Facts**");
    expect(text).toContain("**Rules**");
    expect(text).toContain("Always ask before importing transactions");
    expect(text).toContain("Waiting for you to confirm");
    expect(text).toContain("Likes sushi");
  });
});
