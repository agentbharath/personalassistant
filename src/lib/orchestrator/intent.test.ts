import { describe, expect, it } from "vitest";
import { classifyDeterministically } from "./intent";

describe("receipt lookups", () => {
  it.each([
    "Show receipts from the past 30 days, but exclude promotional offers and shipping updates.",
    "Did I receive any duplicate receipts or invoices for the same purchase?",
  ])("route to email, not finance: %s", (input) => {
    expect(classifyDeterministically(input)?.intents[0].agent).toBe("email");
  });
  it("still routes spend statements to finance", () => {
    expect(classifyDeterministically("I spent $24.50 at Curry Point today")?.intents[0].agent).toBe("finance");
  });
});
