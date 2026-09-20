import { describe, expect, it } from "vitest";
import { buildContextCheckpoint, summarizeConversationTitle } from "./store";

describe("conversation context checkpoints", () => {
  it("bounds encrypted summary plaintext before storage", () => {
    const checkpoint = buildContextCheckpoint("old fact ".repeat(500), Array.from({ length: 30 }, (_, index) => `User: message ${index} ${"x".repeat(500)}`));
    expect(checkpoint.length).toBeLessThanOrEqual(4_000);
    expect(checkpoint).toContain("message 29");
  });

  it("keeps concise deterministic conversation titles", () => {
    expect(summarizeConversationTitle("How much did I spend at restaurants this month?" )).toBe("Restaurant spending");
  });
});
