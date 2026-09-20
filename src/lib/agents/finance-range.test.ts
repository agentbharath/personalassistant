import { describe, expect, it } from "vitest";
import { categoryBreakdown, spendingRange } from "./finance";

describe("spending periods (R8.12)", () => {
  it.each(["show my total spendings so far", "how much have I spent overall", "what did I spend to date", "total spending all time", "spent altogether", "spending in total"])("%s → everything recorded", (input) => {
    expect(spendingRange(input)).toMatchObject({ from: "2000-01-01", label: "so far" });
  });
  it("keeps this month as the default and the existing named periods", () => {
    expect(spendingRange("show my spendings").label).toBe("this month");
    expect(spendingRange("what did I spend last month").label).toBe("last month");
    expect(spendingRange("what did I spend this year").label).toBe("this year");
    expect(spendingRange("spending this week").label).toBe("this week");
  });
  it("understands rolling windows", () => {
    expect(spendingRange("spending in the last 60 days").label).toBe("in the last 60 days");
    expect(spendingRange("what did I spend in the past 2 weeks").label).toBe("in the last 14 days");
  });
});

describe("category breakdown (R8.12)", () => {
  it("groups older, differently-written categories together", () => {
    const text = categoryBreakdown([{ category: "Shopping", amountMinor: 1000 }, { category: "shopping", amountMinor: 500 }, { category: "Health & Wellness", amountMinor: 700 }, { category: "health", amountMinor: 300 }], "USD");
    expect(text.split("\n")).toEqual(["- Shopping — $15.00 · 2", "- Health — $10.00 · 2"]);
  });
  it("totals per category, largest first, with counts", () => {
    const text = categoryBreakdown([
      { category: "restaurants", amountMinor: 2248 }, { category: "restaurants", amountMinor: 2516 },
      { category: "utilities", amountMinor: 14630 }, { category: "shopping", amountMinor: 3553 },
    ], "USD");
    expect(text.split("\n")).toEqual(["- Utilities — $146.30 · 1", "- Restaurants — $47.64 · 2", "- Shopping — $35.53 · 1"]);
  });
});
