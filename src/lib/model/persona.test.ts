import { describe, expect, it } from "vitest";
import { DAYLARK_PERSONA } from "./persona";

describe("Daylark persona guardrails", () => {
  it("does not diagnose or cite unevidenced research in vulnerable conversations", () => {
    expect(DAYLARK_PERSONA).toContain("without diagnosing");
    expect(DAYLARK_PERSONA).toContain("unless evidence was actually retrieved");
  });

  it("contains an explicit safety escalation rule", () => {
    expect(DAYLARK_PERSONA).toContain("possible self-harm");
    expect(DAYLARK_PERSONA).toContain("immediate danger");
  });
});
