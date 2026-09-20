import { Temporal } from "@js-temporal/polyfill";
import type { Bill } from "@/lib/agents/bills";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { GoogleCalendarAccessError, listCalendarEvents, type CalendarEvent } from "@/lib/tools/calendar/google-calendar";
import { listBills } from "@/lib/tools/finance/bills";
import { listTransactions } from "@/lib/tools/finance/transactions";
import { WEEK_DAYS, billBuckets, spendingWindow, weeklySpending, type BillBuckets, type WeeklySpending } from "./brief";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

/** Each part loads on its own, so one service being down never hides the rest. */
export type Section<T> = { state: "ok"; value: T } | { state: "needs_connection" } | { state: "unavailable" };

export type DailyView = {
  today: string;
  meetingsToday: Section<CalendarEvent[]>;
  meetingsAhead: Section<CalendarEvent[]>;
  bills: Section<BillBuckets>;
  spending: Section<WeeklySpending | null>;
};

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try { return { state: "ok", value: await load() }; }
  catch (error) {
    if (error instanceof GoogleConnectionRequiredError || (error instanceof GoogleCalendarAccessError && error.reason === "insufficient_scope")) return { state: "needs_connection" };
    return { state: "unavailable" };
  }
}

export async function loadDailyView(userId: string, now = Temporal.Now.zonedDateTimeISO(TIME_ZONE)): Promise<DailyView> {
  const today = now.toPlainDate();
  const dayStart = today.toZonedDateTime({ timeZone: TIME_ZONE, plainTime: { hour: 0 } });
  const tomorrowStart = dayStart.add({ days: 1 });
  const weekEnd = dayStart.add({ days: WEEK_DAYS + 1 });
  const events = await section(() => listCalendarEvents(userId, dayStart.toInstant().toString(), weekEnd.toInstant().toString()));
  const startsBefore = (event: CalendarEvent, limit: Temporal.ZonedDateTime) => event.allDay
    ? event.start < limit.toPlainDate().toString()
    : Temporal.Instant.compare(Temporal.Instant.from(event.start), limit.toInstant()) < 0;
  const meetings = (pick: (event: CalendarEvent) => boolean): Section<CalendarEvent[]> => events.state === "ok" ? { state: "ok", value: events.value.filter(pick) } : events;

  const window = spendingWindow(today.toString());
  const [bills, spending] = await Promise.all([
    section<BillBuckets>(async () => billBuckets(await listBills(userId, "outstanding") as Bill[], today.toString())),
    section(async () => weeklySpending(await listTransactions(userId, window.from, window.to), today.toString())),
  ]);
  return {
    today: today.toString(),
    meetingsToday: meetings((event) => startsBefore(event, tomorrowStart)),
    meetingsAhead: meetings((event) => !startsBefore(event, tomorrowStart)),
    bills,
    spending,
  };
}
