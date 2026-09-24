import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ answerCalendar: vi.fn(async () => "CALENDAR"), answerPublicSearch: vi.fn(async () => "SEARCH") }));
vi.mock("@/lib/agents/calendar", () => ({ answerCalendar: mocks.answerCalendar }));
vi.mock("@/lib/agents/email", () => ({ answerEmail: vi.fn() }));
vi.mock("@/lib/agents/finance", () => ({ answerFinance: vi.fn() }));
vi.mock("@/lib/agents/general", () => ({ answerPublicSearch: mocks.answerPublicSearch }));
vi.mock("@/lib/runtime/query-budget", () => ({ prepareAgentStage: () => undefined }));
import { composeMultiAgentAnswer, executeReadOnlyAgentPlan } from "./multi-agent";

describe("multi-agent partial results", () => {
  it("preserves successful results and clearly identifies a failed agent", () => {
    const answer = composeMultiAgentAnswer([
      { agent: "calendar", ok: true, answer: "You are free after 3 PM." },
      { agent: "email", ok: false },
    ]);
    expect(answer).toContain("### Calendar");
    expect(answer).toContain("free after 3 PM");
    expect(answer).toContain("couldn’t complete the email part");
  });

  it("does not claim success when every agent fails", () => {
    expect(composeMultiAgentAnswer([{ agent: "finance", ok: false }])).toContain("couldn’t complete any part");
  });
});

describe("the general clause of a multi-part request (R19.5)", () => {
  it("searches the router's own well-formed query, not the raw regex-split sentence, when one was given", async () => {
    await executeReadOnlyAgentPlan(
      [{ agent: "general", instruction: "plan a trip to colorado this upcoming thanksgiving weekend" }],
      "plan a trip to colorado this upcoming thanksgiving weekend", "u1", [],
      "Thanksgiving activities in Colorado",
    );
    expect(mocks.answerPublicSearch).toHaveBeenCalledWith("Thanksgiving activities in Colorado", undefined, "");
  });
  it("falls back to the raw clause when the router gave no query (never fails the search entirely)", async () => {
    await executeReadOnlyAgentPlan([{ agent: "general", instruction: "best hiking trails" }], "input", "u1", [], null);
    expect(mocks.answerPublicSearch).toHaveBeenCalledWith("best hiking trails", undefined, "");
  });
  it("passes memory context through to the general clause too", async () => {
    await executeReadOnlyAgentPlan([{ agent: "general", instruction: "x" }], "x", "u1", [], "a query", "diet fact");
    expect(mocks.answerPublicSearch).toHaveBeenCalledWith("a query", undefined, "diet fact");
  });
});
