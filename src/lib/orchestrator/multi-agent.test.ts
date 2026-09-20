import { describe, expect, it } from "vitest";
import { composeMultiAgentAnswer } from "./multi-agent";

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
