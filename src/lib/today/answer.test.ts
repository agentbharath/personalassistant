import { describe, expect, it } from "vitest";
import { renderDailyView } from "./answer";
import type { DailyView } from "./load";

const bill = (merchant: string, amountMinor: number, dueDate: string | null) => ({ id: merchant, merchant, amountMinor, currency: "USD", category: "utilities", statementDate: "2026-09-01", dueDate, status: "outstanding" as const, paidOn: null });
const view: DailyView = {
  today: "2026-09-21",
  meetingsToday: { state: "ok", value: [{ id: "e", summary: "Dentist", start: "2026-09-21T21:00:00Z", end: "2026-09-21T22:00:00Z", allDay: false, location: "Bay Dental" }] },
  meetingsAhead: { state: "ok", value: [{ id: "f", summary: "Dinner", start: "2026-09-23T01:00:00Z", end: "2026-09-23T03:00:00Z", allDay: false }] },
  bills: { state: "ok", value: { overdue: [bill("Comcast", 8999, "2026-09-15")], dueToday: [bill("PG&E", 15000, "2026-09-21")], dueThisWeek: [bill("Rent", 240000, "2026-09-28")], noDueDate: [] } },
  spending: { state: "ok", value: { currency: "USD", from: "2026-09-15", to: "2026-09-21", total: 41250, count: 9, previousTotal: 33000, changePercent: 25, dailyAverage: 5893, topCategories: [{ category: "groceries", amountMinor: 18000, sharePercent: 44 }], biggest: { merchant: "Costco", amountMinor: 11000, occurredOn: "2026-09-16" }, otherCurrencyCount: 0 } },
};

describe("the daily view as a chat answer (free)", () => {
  it("writes meetings, bills and spending from the same data as the Today page", () => {
    const text = renderDailyView(view);
    expect(text).toContain("Monday, September 21");
    expect(text).toContain("2:00 PM · Dentist (Bay Dental)");
    expect(text).toContain("Comcast, $89.99 · overdue");
    expect(text).toContain("PG&E, $150.00 · due today");
    expect(text).toContain("Rent, $2,400.00 · due Sep 28");
    expect(text).toContain("Total to pay: **$2,639.99**");
    expect(text).toContain("**$412.50** across 9 purchases, up 25% on the week before");
    expect(text).toContain("Biggest: Costco, $110.00 on Sep 16.");
  });

  it("says what is missing, per section, without hiding the rest", () => {
    const text = renderDailyView({ ...view, meetingsToday: { state: "needs_connection" }, meetingsAhead: { state: "needs_connection" }, spending: { state: "unavailable" } });
    expect(text).toContain("Google isn't connected");
    expect(text).toContain("I couldn't load your spending just now");
    expect(text).toContain("Comcast");
  });

  it("has plain empty states", () => {
    const text = renderDailyView({ ...view, meetingsToday: { state: "ok", value: [] }, meetingsAhead: { state: "ok", value: [] }, bills: { state: "ok", value: { overdue: [], dueToday: [], dueThisWeek: [], noDueDate: [] } }, spending: { state: "ok", value: null } });
    expect(text).toContain("Nothing on your calendar today.");
    expect(text).toContain("No unpaid bills.");
    expect(text).toContain("No spending recorded in the last 7 days.");
  });
});
