import { describe, expect, it, vi } from "vitest";
import { repairSearchQuery } from "./search-query";

const reply = (value: unknown) => vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(value) }] } as never);
const context = [{ role: "user" as const, content: "find me windbreakers" }, { role: "assistant" as const, content: "### Windbreakers\n\n**All In Motion** — $24" }];

describe("repairSearchQuery (free)", () => {
  it("returns the model's self-contained query, trimmed and bounded", async () => {
    expect(await repairSearchQuery("Verify medium size availability", context, reply({ query: "  medium windbreaker size availability  " }))).toBe("medium windbreaker size availability");
    expect((await repairSearchQuery("x", context, reply({ query: "a".repeat(500) })))?.length).toBe(300);
  });

  it("shows the model the conversation and the follow-up", async () => {
    const complete = reply({ query: "q" });
    await repairSearchQuery("Compare Target vs Walmart", context, complete);
    const content = complete.mock.calls[0][0].messages[0].content as string;
    expect(content).toContain("All In Motion");
    expect(content).toContain("Compare Target vs Walmart");
  });

  it("is null when the conversation doesn't say what it's about, or anything goes wrong, so the caller can still ask", async () => {
    expect(await repairSearchQuery("ok", [], reply({ query: "" }))).toBeNull();
    expect(await repairSearchQuery("ok", context, vi.fn().mockRejectedValue(new Error("boom")))).toBeNull();
    expect(await repairSearchQuery("ok", context, vi.fn().mockResolvedValue({ content: [] }))).toBeNull();
  });
});
