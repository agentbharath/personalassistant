import { describe, expect, it } from "vitest";
import { DAYLARK_PERSONA } from "./persona";

describe("Daylark persona guardrails", () => {
  it("does not diagnose or cite unevidenced research in vulnerable conversations", () => {
    expect(DAYLARK_PERSONA).toContain("without diagnosing");
    expect(DAYLARK_PERSONA).toContain("unless evidence was actually retrieved");
  });

  it("contains an explicit safety escalation rule", () => {
    expect(DAYLARK_PERSONA).toContain("self-harm risk");
    expect(DAYLARK_PERSONA).toContain("immediate danger");
  });

  it("never comments on a repeated question, found live: \"I notice you've asked this three times now\" read as irritated, not helpful", () => {
    expect(DAYLARK_PERSONA).toContain("Never comment on how many times the person has asked something");
  });
});
