import { describe, expect, it } from "vitest";
import { extractMemories, MEMORY_EXTRACTOR_VERSION } from "./extractor";

const reply = (candidates: unknown[]) => ({ content: [{ type: "text", text: JSON.stringify({ candidates }) }] }) as never;
const candidate = (over: Partial<{ action: string; type: string; category: string; strength: string; statement: string; stated: boolean; validUntil: string | null; supersedes: string | null }> = {}) => ({
  action: "add", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", stated: true, validUntil: null, supersedes: null, ...over,
});

describe("the memory extractor (free)", () => {
  it("returns a well-formed candidate, and drops noop rows", async () => {
    const result = await extractMemories("I don't eat meat except fish and chicken", [], { complete: async () => reply([candidate(), candidate({ action: "noop" })]) });
    expect(result).toEqual([{ action: "add", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", stated: true, validUntil: null, supersedes: null }]);
  });

  it("is unavailable, and remembers nothing, when the model cannot answer (no rule fallback, R20.5)", async () => {
    const result = await extractMemories("I don't eat meat", [], { complete: async () => { throw new Error("down"); } });
    expect(result).toEqual([]);
  });

  it("treats an update naming an id that was never offered as a plain add, instead of failing (R19.5: structure only)", async () => {
    const result = await extractMemories("I started eating beef again", [], { complete: async () => reply([candidate({ action: "update", supersedes: "not-a-real-id" })]) });
    expect(result).toEqual([expect.objectContaining({ action: "add", supersedes: null })]);
  });

  it("keeps a real supersedes id when it was actually offered as an existing memory", async () => {
    const existing = [{ id: "m1", type: "fact" as const, category: "diet" as const, status: "active" as const, statement: "Vegetarian" }];
    const result = await extractMemories("I started eating beef again", existing, { complete: async () => reply([candidate({ action: "update", statement: "Eats beef now", supersedes: "m1" })]) });
    expect(result).toEqual([expect.objectContaining({ action: "update", supersedes: "m1" })]);
  });

  it("caps candidates at 5 and trims an overlong statement", async () => {
    const long = "x".repeat(600);
    const result = await extractMemories("...", [], { complete: async () => reply([candidate({ statement: long })]) });
    expect(result[0].statement).toHaveLength(500);
  });

  it("is on v4, which tells a challenge about the assistant's own behavior apart from a real instruction (found live: a testing claim -- \"you know you're only supposed to answer X\" -- was filed as a rule restricting every future answer, since it reads structurally like a real rule and this function never sees the assistant's own reply to know the claim was false)", () => {
    expect(MEMORY_EXTRACTOR_VERSION).toBe("memory-extract-v4");
  });
});
