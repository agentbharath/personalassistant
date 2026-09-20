import { describe, expect, it } from "vitest";
import { acceptedCapabilityBridge, capabilityBridge, classifyCasualMessage, crisisResponse, outOfScopeResponse, pendingWebBridgeLocation, SCOPE_REFUSAL } from "./scope";

describe("Daylark capability allowlist", () => {
  it.each([
    "help me with my relationship",
    "teach me Python",
    "write my research paper",
    "generate an image of a dog",
    "explain this math lesson",
    "give me medical advice",
  ])("rejects unsupported request: %s", (input) => {
    expect(outOfScopeResponse(input)).toBe(SCOPE_REFUSAL);
  });

  it("bridges emotions into supported capabilities without counseling", () => {
    expect(capabilityBridge("I'm feeling bored")).toEqual({
      capability: "web",
      answer: "Hmm—want me to search for fun things happening near you?",
    });
    expect(capabilityBridge("I feel like I'm not rich enough")).toMatchObject({ capability: "finance" });
  });

  it("continues an accepted capability offer", () => {
    const context = [{ role: "assistant" as const, content: "Money can feel vague until we put numbers around it. Want me to review your recent spending and recurring bills?" }];
    expect(acceptedCapabilityBridge("yes", context)).toEqual({ capability: "finance" });
  });

  it("turns the supplied location into the promised public search", () => {
    const context = [{ role: "assistant" as const, content: "What city or ZIP code should I search around?" }];
    expect(pendingWebBridgeLocation("Sunnyvale, CA", context)).toBe("Fun activities and events happening near Sunnyvale, CA");
  });

  it("classifies casual messages without prescribing their wording", () => {
    expect(classifyCasualMessage("come on, let's chill bro")).toBe("banter");
    expect(classifyCasualMessage("I'm asking what's in your scope")).toBe("capabilities");
    expect(classifyCasualMessage("what is in your scope then asshole")).toBe("rude");
    expect(classifyCasualMessage("hey stupid")).toBe("rude");
  });

  it.each([
    "find my latest Amazon email",
    "show my calendar tomorrow",
    "how much did I spend this month",
    "find current restaurants near me",
  ])("does not preempt supported request: %s", (input) => {
    expect(outOfScopeResponse(input)).toBeNull();
  });

  it("provides crisis help only for first-person harm intent", () => {
    expect(crisisResponse("I want to kill myself")).toContain("call or text 988");
    expect(crisisResponse("I am going to hurt someone")).toContain("immediate danger");
    expect(crisisResponse("What is self-harm?")).toBeNull();
  });
});
