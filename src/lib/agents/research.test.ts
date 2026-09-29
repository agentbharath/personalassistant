import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  complete: vi.fn(),
  models: { fast: "claude-haiku-4-5-20251001", high: "claude-haiku-4-5-20251001" } as Record<"fast" | "high", string>,
}));

vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: (...args: unknown[]) => mocks.search(...args) }));
vi.mock("@/lib/runtime/query-budget", () => ({ prepareAgentStage: () => undefined, configuredModel: (tier: "fast" | "balanced" | "high") => mocks.models[tier === "balanced" ? "high" : tier] }));
vi.mock("@/lib/runtime/request-context", () => ({ extendRequestBudget: () => undefined }));

import { critiqueComparison, runResearch, type Comparison, type ResearchDeps } from "./research";

const deps: ResearchDeps = { complete: (...args) => mocks.complete(...args) };
const research = (subject: string, options: string[] = []) => runResearch(subject, options, deps);

const source = (n: number) => ({ title: `Guide ${n}`, url: `https://example.com/${n}`, snippet: `Evidence ${n}` });
const modelReply = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const facts = { facts: [
  { option: "Coway Airmega 400", category: "price" as const, detail: "$649 MSRP", source: 1 },
  { option: "Levoit Core 600S", category: "price" as const, detail: "$239.99 MSRP", source: 2 },
] };
const comparison = (over: Partial<Comparison> = {}): Comparison => ({
  recommendation: "Go with the Levoit Core 600S for the price.", reasoning: "It costs less and still covers a mid-size room well.",
  options: [
    { name: "Coway Airmega 400", facts: [{ detail: "$649 MSRP", source: 1 }] },
    { name: "Levoit Core 600S", facts: [{ detail: "$239.99 MSRP", source: 2 }] },
  ],
  caveat: "",
  ...over,
});

beforeEach(() => {
  mocks.models = { fast: "claude-haiku-4-5-20251001", high: "claude-haiku-4-5-20251001" };
  mocks.search.mockReset().mockResolvedValue({ answer: "", sources: [source(1), source(2)] });
  mocks.complete.mockReset().mockImplementation(async (operation: string) => {
    if (operation === "research_fact_extraction") return modelReply(facts);
    if (operation === "research_comparison_composition") return modelReply(comparison());
    throw new Error(`unexpected operation ${operation}`);
  });
});

describe("the comparison critic checks shape only, never the model's judgment (R20.6, R47)", () => {
  it("flags fewer than 2 options compared", () => {
    expect(critiqueComparison(comparison({ options: comparison().options.slice(0, 1) }), 2).some((issue) => issue.includes("at least 2"))).toBe(true);
  });
  it("flags an option with no facts", () => {
    const withEmptyOption = comparison(); withEmptyOption.options[0].facts = [];
    expect(critiqueComparison(withEmptyOption, 2).some((issue) => issue.includes("no facts"))).toBe(true);
  });
  it("flags a citation that points at no real source", () => {
    const withBadSource = comparison(); withBadSource.options[0].facts[0].source = 9;
    expect(critiqueComparison(withBadSource, 2).some((issue) => issue.includes("not one of"))).toBe(true);
  });
  it("passes a well-formed comparison", () => {
    expect(critiqueComparison(comparison(), 2)).toEqual([]);
  });
});

describe("the full pipeline (research -> extract -> compose -> critique -> render), never the single-shot search-and-summarize path", () => {
  it("researches one query per named option instead of one shallow lookup", async () => {
    await research("air purifiers", ["Coway Airmega 400", "Levoit Core 600S"]);
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls.every((call) => call[1]?.depth === "advanced")).toBe(true);
  });

  it("fans out broader exploratory queries when no options are named", async () => {
    await research("budget laptops");
    expect(mocks.search.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("renders a decisive recommendation with per-option facts and sources, not a hedge", async () => {
    const answer = await research("air purifiers", ["Coway Airmega 400", "Levoit Core 600S"]);
    expect(answer).toContain("### air purifiers");
    expect(answer).toContain("Go with the Levoit Core 600S");
    expect(answer).toContain("#### Coway Airmega 400");
    expect(answer).toContain("#### Levoit Core 600S");
    expect(answer).toContain("$649 MSRP");
    expect(answer).toContain("### Sources");
  });

  it("never hard-truncates a legitimate multi-sentence reasoning mid-word (found live, R47: a 500-char cap cut off \"...is\" mid-sentence)", async () => {
    const sentence = "The Winix 5500-2 costs less and covers more square footage than the Coway. ";
    const long = sentence.repeat(8).trim(); // well over the old 500-char cap, under the new 900
    expect(long.length).toBeGreaterThan(500);
    expect(long.length).toBeLessThan(900);
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "research_fact_extraction") return modelReply(facts);
      return modelReply(comparison({ reasoning: long }));
    });
    const answer = await research("air purifiers", ["Coway Airmega 400", "Levoit Core 600S"]);
    expect(answer).toContain(long);
  });

  it("says so plainly instead of guessing when research turns up nothing", async () => {
    mocks.search.mockResolvedValue({ answer: "", sources: [] });
    expect(await research("nonexistent gadget")).toMatch(/couldn't find reliable current information/);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("degrades to \"nothing specific enough\" instead of crashing when extraction's response is malformed or truncated", async () => {
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "research_fact_extraction") return { content: [{ type: "text", text: "{\"facts\": [ not valid json" }] };
      return modelReply(comparison());
    });
    const answer = await research("air purifiers");
    expect(answer).toMatch(/nothing specific enough/);
  });

  it("retries once with a corrective note, then still returns an answer, when composition's response is malformed or truncated", async () => {
    let compositions = 0;
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "research_fact_extraction") return modelReply(facts);
      compositions += 1;
      if (compositions === 1) return { content: [{ type: "text", text: "{\"recommendation\": \"cut off mid" }] };
      return modelReply(comparison());
    });
    const answer = await research("air purifiers");
    expect(compositions).toBe(2);
    expect(mocks.complete.mock.calls[2][1].messages[0].content).toMatch(/could not be read as valid JSON/);
    expect(answer).toContain("Go with the Levoit Core 600S");

    compositions = 0;
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "research_fact_extraction") return modelReply(facts);
      compositions += 1;
      return { content: [{ type: "text", text: "not json at all" }] };
    });
    expect(await research("air purifiers")).toMatch(/ran into a problem putting that comparison together/);
    expect(compositions).toBe(2); // one repair attempt, then it gives up rather than looping
  });

  it("repairs once when the composer's own output does not match its spec (fewer than 2 options)", async () => {
    let compositions = 0;
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "research_fact_extraction") return modelReply(facts);
      compositions += 1;
      return modelReply(compositions === 1 ? comparison({ options: comparison().options.slice(0, 1) }) : comparison());
    });
    const answer = await research("air purifiers");
    expect(compositions).toBe(2);
    expect(mocks.complete.mock.calls[2][1].messages[0].content).toMatch(/must compare at least 2/);
    expect(answer).toContain("#### Levoit Core 600S");
  });

  it("never sends `temperature` when the composer's model is one that rejects it (Sonnet/Opus's own API contract), but still does for Haiku", async () => {
    mocks.models.high = "claude-opus-5";
    await research("air purifiers");
    const extraction = mocks.complete.mock.calls.find((call) => call[0] === "research_fact_extraction");
    const composition = mocks.complete.mock.calls.find((call) => call[0] === "research_comparison_composition");
    expect(extraction?.[1]).toHaveProperty("temperature", 0);
    expect(composition?.[1]).not.toHaveProperty("temperature");
  });

  it("hands the finished comparison to `remember`, so a later chat can recall it (found live, R47: research mode had no persistence at all before this)", async () => {
    const remember = vi.fn().mockResolvedValue(undefined);
    await runResearch("air purifiers", ["Coway Airmega 400", "Levoit Core 600S"], deps, remember);
    expect(remember).toHaveBeenCalledWith({ subject: "air purifiers", recommendation: "Go with the Levoit Core 600S for the price.", options: ["Coway Airmega 400", "Levoit Core 600S"] });
  });

  it("never calls `remember` when there's nothing real to save, and a failure saving never breaks the answer", async () => {
    const remember = vi.fn().mockResolvedValue(undefined);
    mocks.search.mockResolvedValue({ answer: "", sources: [] });
    await runResearch("nonexistent gadget", [], deps, remember); // no comparison ever gets composed, so nothing to save
    expect(remember).not.toHaveBeenCalled();

    mocks.search.mockResolvedValue({ answer: "", sources: [source(1), source(2)] });
    const failing = vi.fn().mockRejectedValue(new Error("db down"));
    const answer = await runResearch("air purifiers", [], deps, failing);
    expect(answer).toContain("Go with the Levoit Core 600S");
  });
});
