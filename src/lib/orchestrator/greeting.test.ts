import { describe, expect, it } from "vitest";
import { isGreetingOnly } from "./run";

describe("deterministic greetings", () => {
  it.each(["hi", "Hello!", "hey", "good morning"])("handles %s without a model call", (input) => {
    expect(isGreetingOnly(input)).toBe(true);
  });

  it("does not consume a substantive request", () => {
    expect(isGreetingOnly("Hi, show my calendar")).toBe(false);
  });

});
