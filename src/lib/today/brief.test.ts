import { describe, expect, it } from "vitest";
import type { Bill } from "@/lib/agents/bills";
import { billBuckets, billsTotal, money, spendingWindow, weeklySpending, type SpendingRecord } from "./brief";

const today = "2026-09-21";
const bill = (over: Partial<Bill>): Bill => ({ id: "b", merchant: "PG&E", amountMinor: 15000, currency: "USD", category: "utilities", statementDate: "2026-09-01", dueDate: today, status: "outstanding", paidOn: null, ...over });
const spend = (over: Partial<SpendingRecord>): SpendingRecord => ({ occurredOn: today, amountMinor: 1000, currency: "USD", direction: "expense", merchant: "Shop", category: "shopping", ...over });

describe("bills due today and this week (free)", () => {
  it("sorts outstanding bills into overdue, today, the next seven days and no due date, and ignores paid ones", () => {
    const buckets = billBuckets([
      bill({ id: "late", dueDate: "2026-09-15" }),
      bill({ id: "now", dueDate: "2026-09-21" }),
      bill({ id: "soon", dueDate: "2026-09-28" }),
      bill({ id: "later", dueDate: "2026-09-29" }),
      bill({ id: "none", dueDate: null }),
      bill({ id: "paid", dueDate: "2026-09-22", status: "paid", paidOn: "2026-09-20" }),
    ], today);
    expect(buckets.overdue.map((item) => item.id)).toEqual(["late"]);
    expect(buckets.dueToday.map((item) => item.id)).toEqual(["now"]);
    expect(buckets.dueThisWeek.map((item) => item.id)).toEqual(["soon"]);
    expect(buckets.noDueDate.map((item) => item.id)).toEqual(["none"]);
  });

  it("orders each group by due date", () => {
    const buckets = billBuckets([bill({ id: "b", dueDate: "2026-09-26" }), bill({ id: "a", dueDate: "2026-09-23" })], today);
    expect(buckets.dueThisWeek.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("totals bills in one currency and refuses to add mixed currencies", () => {
    expect(billsTotal([bill({}), bill({ amountMinor: 500 })])).toEqual({ amountMinor: 15500, currency: "USD" });
    expect(billsTotal([bill({}), bill({ currency: "EUR" })])).toBeNull();
    expect(billsTotal([])).toBeNull();
  });
});

describe("this week's spending habit (free)", () => {
  it("is null when nothing was spent in the last seven days", () => {
    expect(weeklySpending([], today)).toBeNull();
    expect(weeklySpending([spend({ occurredOn: "2026-09-10" })], today)).toBeNull();
    expect(weeklySpending([spend({ direction: "income" })], today)).toBeNull();
  });

  it("totals the seven days ending today, compares with the seven before, and names the top categories and the biggest purchase", () => {
    const week = weeklySpending([
      spend({ occurredOn: "2026-09-21", amountMinor: 4000, category: "groceries", merchant: "Trader Joe's" }),
      spend({ occurredOn: "2026-09-15", amountMinor: 6000, category: "restaurants", merchant: "Curry Point" }),
      spend({ occurredOn: "2026-09-16", amountMinor: 2000, category: "groceries", merchant: "Costco" }),
      spend({ occurredOn: "2026-09-14", amountMinor: 99999 }), // eight days ago: the previous week
      spend({ occurredOn: "2026-09-10", amountMinor: 6000 }), // previous week
      spend({ occurredOn: "2026-09-16", amountMinor: 5000, direction: "income" }), // income is not spending
    ], today)!;
    expect(week.from).toBe("2026-09-15");
    expect(week.total).toBe(12000);
    expect(week.count).toBe(3);
    expect(week.previousTotal).toBe(105999);
    expect(week.changePercent).toBe(-89);
    expect(week.dailyAverage).toBe(1714);
    expect(week.topCategories).toEqual([{ category: "groceries", amountMinor: 6000, sharePercent: 50 }, { category: "restaurants", amountMinor: 6000, sharePercent: 50 }]);
    expect(week.biggest).toEqual({ merchant: "Curry Point", amountMinor: 6000, occurredOn: "2026-09-15" });
  });

  it("has no percentage change when the earlier week had no spending", () => {
    expect(weeklySpending([spend({})], today)!.changePercent).toBeNull();
  });

  it("uses the main currency and counts, but does not add, the others", () => {
    const week = weeklySpending([spend({ amountMinor: 5000 }), spend({ amountMinor: 700, currency: "EUR" })], today)!;
    expect(week).toMatchObject({ currency: "USD", total: 5000, otherCurrencyCount: 1 });
  });

  it("asks a caller to load fourteen days", () => {
    expect(spendingWindow(today)).toEqual({ from: "2026-09-08", to: "2026-09-21" });
  });

  it("formats money with its currency", () => {
    expect(money(15050, "USD")).toBe("$150.50");
  });
});
