import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadDailyView: vi.fn() }));
vi.mock("./load", async (importOriginal) => ({ ...(await importOriginal<object>()), loadDailyView: mocks.loadDailyView }));
import { answerDailyView, renderDailyView } from "./answer";
import type { DailyView } from "./load";

const bill = (merchant: string, amountMinor: number, dueDate: string | null) => ({ id: merchant, merchant, amountMinor, currency: "USD", category: "utilities", statementDate: "2026-09-01", dueDate, status: "outstanding" as const, paidOn: null });
const view: DailyView = {
  today: "2026-09-21",
  meetingsToday: { state: "ok", value: [{ id: "e", summary: "Dentist", start: "2026-09-21T21:00:00Z", end: "2026-09-21T22:00:00Z", allDay: false, location: "Bay Dental" }] },
  meetingsAhead: { state: "ok", value: [{ id: "f", summary: "Dinner", start: "2026-09-23T01:00:00Z", end: "2026-09-23T03:00:00Z", allDay: false }] },
  bills: { state: "ok", value: { overdue: [bill("Comcast", 8999, "2026-09-15")], dueToday: [bill("PG&E", 15000, "2026-09-21")], dueThisWeek: [bill("Rent", 240000, "2026-09-28")], dueLater: [], noDueDate: [] } },
  // Distinct from spendingToday on purpose, so a test asserting on one can't accidentally pass by reading the other.
  spending: { state: "ok", value: { currency: "USD", from: "2026-09-15", to: "2026-09-21", total: 41250, count: 9, previousTotal: 33000, changePercent: 25, dailyAverage: 5893, categories: [{ category: "groceries", amountMinor: 18000, sharePercent: 44, entries: [] }], biggest: { merchant: "Costco", amountMinor: 11000, occurredOn: "2026-09-16" }, otherCurrencyCount: 0 } },
  spendingToday: { state: "ok", value: { currency: "USD", from: "2026-09-21", to: "2026-09-21", total: 4360, count: 2, previousTotal: 2000, changePercent: 118, dailyAverage: 4360, categories: [{ category: "restaurants", amountMinor: 4360, sharePercent: 100, entries: [] }], biggest: { merchant: "Ginger Cafe", amountMinor: 3000, occurredOn: "2026-09-21" }, otherCurrencyCount: 0 } },
};

describe("the daily view as a chat answer (free)", () => {
  it("writes meetings, bills and spending scoped to today (R41) from the same data as the Today page", () => {
    const text = renderDailyView(view);
    expect(text).toContain("Monday, September 21");
    expect(text).toContain("2:00 PM · Dentist (Bay Dental)");
    expect(text).toContain("Comcast, $89.99 · overdue");
    expect(text).toContain("PG&E, $150.00 · due today");
    // A bill due later this week belongs to bills_list, not a day overview -- it's in `view.bills.value` (Perch keeps showing it) but
    // never in this rendered text, and the total only sums overdue + due-today.
    expect(text).not.toContain("Rent");
    expect(text).toContain("Total to pay (USD): **$239.99**");
    expect(text).toContain("**$43.60** across 2 purchases, up 118% on yesterday");
    expect(text).toContain("Biggest: Ginger Cafe, $30.00.");
    // The last-7-days habit view is loaded (Perch reads it), just never shown in this today-scoped answer.
    expect(text).not.toContain("$412.50");
  });

  it("says what is missing, per section, without hiding the rest", () => {
    const text = renderDailyView({ ...view, meetingsToday: { state: "needs_connection" }, meetingsAhead: { state: "needs_connection" }, spendingToday: { state: "unavailable" } });
    expect(text).toContain("Google isn't connected");
    expect(text).toContain("I couldn't load your spending just now");
    expect(text).toContain("Comcast");
  });

  it("has plain empty states", () => {
    const text = renderDailyView({ ...view, meetingsToday: { state: "ok", value: [] }, meetingsAhead: { state: "ok", value: [] }, bills: { state: "ok", value: { overdue: [], dueToday: [], dueThisWeek: [], dueLater: [], noDueDate: [] } }, spendingToday: { state: "ok", value: null } });
    expect(text).toContain("Nothing on your calendar today.");
    expect(text).toContain("No bills due today.");
    expect(text).toContain("No spending recorded today.");
  });

  it("puts a blank line after each heading and before the closing lines, so they do not run together when shown as markdown", () => {
    const text = renderDailyView(view);
    for (const heading of ["**Meetings**", "**Bills to pay**", "**Spending today**"]) expect(text).toContain(`${heading}\n\n`);
    expect(text).toMatch(/\n\nBiggest: /);
    expect(text).toMatch(/\n\nTotal to pay \(USD\): /);
  });

  it("drops the Meetings section and the date heading when a day card already covers them, keeping Bills/Spending", () => {
    const text = renderDailyView(view, { includeMeetings: false });
    expect(text).not.toContain("Monday, September 21");
    expect(text).not.toContain("**Meetings**");
    expect(text).not.toContain("Dentist");
    expect(text).toContain("**Bills to pay**");
    expect(text).toContain("Comcast");
    expect(text).not.toMatch(/^\n/); // no leading blank line from the dropped heading
  });
});

describe("answerDailyView (free)", () => {
  it("embeds a day card and shows only Bills/Spending as the visible markdown underneath it", async () => {
    mocks.loadDailyView.mockResolvedValue(view);
    const answer = await answerDailyView("u1");
    expect(answer).toContain("```daylark-card");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.kind).toBe("day");
    expect(card.timeline.some((row: { label: string }) => row.label === "Dentist")).toBe(true);
    const [text] = answer.split("\n\n```daylark-card");
    expect(text).not.toContain("**Meetings**");
    expect(text).toContain("**Bills to pay**");
  });

  it("falls back to the full markdown, no card, when meetings can't load", async () => {
    mocks.loadDailyView.mockResolvedValue({ ...view, meetingsToday: { state: "needs_connection" } });
    const answer = await answerDailyView("u1");
    expect(answer).not.toContain("daylark-card");
    expect(answer).toContain("**Meetings**");
    expect(answer).toContain("Google isn't connected");
  });
});
