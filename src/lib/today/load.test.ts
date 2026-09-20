import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ConnectionRequired extends Error {}
  class CalendarAccess extends Error { constructor(public reason: string) { super(reason); } }
  return { events: vi.fn(), bills: vi.fn(), transactions: vi.fn(), ConnectionRequired, CalendarAccess };
});
const { ConnectionRequired } = mocks;

vi.mock("@/lib/auth/google-credential-broker", () => ({ GoogleConnectionRequiredError: mocks.ConnectionRequired }));
vi.mock("@/lib/tools/calendar/google-calendar", () => ({ GoogleCalendarAccessError: mocks.CalendarAccess, listCalendarEvents: (...args: unknown[]) => mocks.events(...args) }));
vi.mock("@/lib/tools/finance/bills", () => ({ listBills: (...args: unknown[]) => mocks.bills(...args) }));
vi.mock("@/lib/tools/finance/transactions", () => ({ listTransactions: (...args: unknown[]) => mocks.transactions(...args) }));

import { loadDailyView } from "./load";

const now = Temporal.ZonedDateTime.from("2026-09-21T09:00:00-07:00[America/Los_Angeles]");
const event = (id: string, start: string, allDay = false) => ({ id, summary: id, start, end: start, allDay });

beforeEach(() => {
  mocks.events.mockReset().mockResolvedValue([]);
  mocks.bills.mockReset().mockResolvedValue([]);
  mocks.transactions.mockReset().mockResolvedValue([]);
});

describe("the daily view loads each part on its own (free)", () => {
  it("splits meetings into today and the days after, including all-day events", async () => {
    mocks.events.mockResolvedValue([
      event("standup", "2026-09-21T10:00:00-07:00"),
      event("birthday", "2026-09-21", true),
      event("dinner", "2026-09-22T18:00:00-07:00"),
      event("trip", "2026-09-25", true),
    ]);
    const view = await loadDailyView("u1", now);
    const ids = (part: { state: string; value?: { id: string }[] }) => part.value?.map((item) => item.id);
    expect(ids(view.meetingsToday as never)).toEqual(["standup", "birthday"]);
    expect(ids(view.meetingsAhead as never)).toEqual(["dinner", "trip"]);
  });

  it("asks the calendar for today through a week ahead, in the person's time zone", async () => {
    await loadDailyView("u1", now);
    expect(mocks.events).toHaveBeenCalledWith("u1", "2026-09-21T07:00:00Z", "2026-09-29T07:00:00Z");
  });

  it("asks for a reconnect when Google is not connected, and keeps bills and spending", async () => {
    mocks.events.mockRejectedValue(new ConnectionRequired());
    mocks.bills.mockResolvedValue([{ id: "b1", merchant: "PG&E", amountMinor: 100, currency: "USD", category: "utilities", statementDate: "2026-09-01", dueDate: "2026-09-21", status: "outstanding", paidOn: null }]);
    const view = await loadDailyView("u1", now);
    expect(view.meetingsToday.state).toBe("needs_connection");
    expect(view.meetingsAhead.state).toBe("needs_connection");
    expect(view.bills.state === "ok" && view.bills.value.dueToday).toHaveLength(1);
  });

  it("marks only the failing part as unavailable", async () => {
    mocks.transactions.mockRejectedValue(new Error("db down"));
    const view = await loadDailyView("u1", now);
    expect(view.spending.state).toBe("unavailable");
    expect(view.bills.state).toBe("ok");
    expect(view.meetingsToday.state).toBe("ok");
  });

  it("loads fourteen days of spending for the week-on-week comparison", async () => {
    await loadDailyView("u1", now);
    expect(mocks.transactions).toHaveBeenCalledWith("u1", "2026-09-08", "2026-09-21");
  });
});
