import { describe, expect, it } from "vitest";
import { greeting, groupByRecency, matchesQuery, windowMessages } from "./grouping";

const now = new Date(2026, 8, 21, 15, 30); // Mon Sep 21, 2026, 3:30 PM local
const at = (daysAgo: number, hour = 10) => new Date(2026, 8, 21 - daysAgo, hour).toISOString();
const item = (id: string, daysAgo: number) => ({ id, updatedAt: at(daysAgo) });

describe("history is grouped by the viewer's calendar days", () => {
  it("labels Today, Yesterday, the last week, the last month, then months", () => {
    const groups = groupByRecency([item("a", 0), item("b", 0), item("c", 1), item("d", 4), item("e", 20), item("f", 60), item("g", 61)], now);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "July 2026"]);
    expect(groups.map((group) => group.items.map((entry) => entry.id))).toEqual([["a", "b"], ["c"], ["d"], ["e"], ["f", "g"]]);
  });
  it("puts late last night in Yesterday, not Today", () => {
    expect(groupByRecency([{ id: "x", updatedAt: new Date(2026, 8, 20, 23, 59).toISOString() }], now)[0].label).toBe("Yesterday");
  });
  it("handles an empty list", () => expect(groupByRecency([], now)).toEqual([]));
});

describe("a long conversation renders only its newest messages", () => {
  const items = Array.from({ length: 500 }, (_, index) => index);
  it("shows the newest N and reports how many are hidden", () => {
    const { shown, hidden } = windowMessages(items, 150);
    expect(shown).toHaveLength(150);
    expect(shown[0]).toBe(350);
    expect(shown.at(-1)).toBe(499);
    expect(hidden).toBe(350);
  });
  it("shows everything when it fits", () => expect(windowMessages([1, 2, 3], 150)).toEqual({ shown: [1, 2, 3], hidden: 0, offset: 0 }));
});

describe("small helpers", () => {
  it.each([[6, "Good morning"], [13, "Good afternoon"], [19, "Good evening"], [2, "Good evening"]])("hour %i → %s", (hour, text) => expect(greeting(hour)).toBe(text));
  it("filters ignoring case, accents and spacing", () => {
    expect(matchesQuery("Café  Receipts", "cafe rec")).toBe(true);
    expect(matchesQuery("Adobe invoice", "iherb")).toBe(false);
    expect(matchesQuery("anything", "  ")).toBe(true);
  });
});
