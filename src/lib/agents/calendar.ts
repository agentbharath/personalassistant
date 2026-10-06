import { Temporal } from "@js-temporal/polyfill";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { embedCard, type CalendarRangeCardPayload } from "@/lib/chat/card-payload";
import { buildTimelineCard } from "@/lib/today/day-card";
import { TIME_UNAVAILABLE, type CalendarWindow } from "./time-interpreter";
import { interpretTimeForUser } from "./time-interpreter-runtime";
import { GoogleCalendarAccessError, listCalendarEvents, type CalendarEvent } from "@/lib/tools/calendar/google-calendar";

const DEFAULT_TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export { type CalendarWindow };

/** A question about the time, with its likely answers written out so they can be replied to in a word. */
export function askAboutTime(question: string, choices: string[]) {
  return choices.length ? `${question} (${choices.join(" / ")})` : question;
}

export async function answerCalendar(input: string, userId: string, context: { role: "user" | "assistant"; content: string }[] = []) {
  try {
    // R20.5: a model reads which day or range is meant; the code only checks its form.
    const reading = await interpretTimeForUser({ message: input, today: Temporal.Now.zonedDateTimeISO(DEFAULT_TIME_ZONE).toPlainDate().toString(), timeZone: DEFAULT_TIME_ZONE, userId, context });
    if (reading.kind === "unavailable") return TIME_UNAVAILABLE;
    if (reading.kind === "ask") return askAboutTime(reading.question, reading.choices);
    const window = reading.window;
    const events = await listCalendarForWindow(userId, window);
    const text = events.length === 0 ? `Your primary calendar has no events ${window.label}.` : renderEventList(window, events);
    // A single day's worth of window gets the same timeline card as daily_view (hero count, now-marker, free-gap
    // rows); a genuinely multi-day range gets its own day-grouped card instead of the old plain list -- found
    // live: "Invite 1 — Tue, Oct 6, 4:00 PM–5:00 PM" alone wasn't enough to actually see the week.
    if (window.start.until(window.end, { largestUnit: "hours" }).hours > 25) return embedCard(text, buildCalendarRangeCard(window, events));
    return embedCard(text, buildTimelineCard(events, windowDateLabel(window), Temporal.Now.instant().toString(), { dayWord: window.label, standalone: true }));
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError) return "Your Google Calendar connection needs to be refreshed. Sign out, sign back in with Google, and approve Calendar access.";
    if (error instanceof GoogleCalendarAccessError) {
      if (error.reason === "api_disabled") return "Google Calendar API is not enabled for this Google Cloud project. Enable it in Google Cloud Console, wait a few minutes, and try again.";
      if (error.reason === "insufficient_scope") return "The current Google connection does not include Calendar read access. Sign out, sign back in, and approve the Calendar permission.";
      if (error.reason === "forbidden") return "Google denied Calendar access for this account. Confirm the Calendar API is enabled and that this account is an approved OAuth test user.";
      return "Google Calendar is temporarily unavailable. Nothing was changed; please try again shortly.";
    }
    throw error;
  }
}

export function listCalendarForWindow(userId: string, window: CalendarWindow): Promise<CalendarEvent[]> {
  return listCalendarEvents(userId, window.start.toInstant().toString(), window.end.toInstant().toString());
}

/** Named guests, self and any room/resource already excluded upstream -- null when nobody else is listed, not an
 * empty string. Shared by the plain list, the multi-day card and the single-day timeline card's own builder. */
function peopleLabel(event: CalendarEvent): string | null {
  if (!event.attendeeNames?.length) return null;
  return event.moreAttendeeCount ? `${event.attendeeNames.join(", ")} +${event.moreAttendeeCount}` : event.attendeeNames.join(", ");
}

/** Who's in it and how to join, in a few words -- the same detail the timeline and multi-day cards show, for the
 * plain-list fallback every range still carries as its copy/older-client text (found live: "Invite 1 — Tue, Oct 6,
 * 4:00 PM–5:00 PM" alone wasn't enough to tell a meeting apart from a placeholder). */
function eventDetail(event: CalendarEvent): string {
  const people = peopleLabel(event);
  const where = event.location ? ` at ${event.location}` : event.meetingLink ? " (video call)" : "";
  return `${people ? ` with ${people}` : ""}${where}`;
}

function renderEventList(window: CalendarWindow, events: CalendarEvent[]): string {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const lines = events.map((event) => {
    if (event.allDay) return `• ${event.summary} — all day${eventDetail(event)}`;
    const start = formatter.format(new Date(event.start));
    const end = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(event.end));
    return `• ${event.summary} — ${start}–${end}${eventDetail(event)}`;
  });
  return `Here’s your calendar ${window.label}:\n${lines.join("\n")}`;
}

const windowDateLabel = (window: CalendarWindow) => window.start.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });

const eventDuration = (event: CalendarEvent): string | null => {
  if (event.allDay) return null;
  const minutes = Math.round((Temporal.Instant.from(event.end).epochMilliseconds - Temporal.Instant.from(event.start).epochMilliseconds) / 60_000);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours && rest ? `${hours} hr ${rest} min` : hours ? `${hours} hr` : `${rest} min`;
};

/**
 * A genuinely multi-day range ("this week", "next week") grouped by day, each day's events in order -- the same
 * attendee/location/video-call detail the single-day timeline card shows, not just a title and a time. Only days
 * that actually have something on them get a row; a quiet week doesn't print empty headers for every day in
 * between.
 */
function buildCalendarRangeCard(window: CalendarWindow, events: CalendarEvent[]): CalendarRangeCardPayload {
  const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, hour: "numeric", minute: "2-digit" });
  const byDay = new Map<string, CalendarRangeCardPayload["days"][number]>();
  const sorted = events.slice().sort((a, b) => Temporal.Instant.compare(Temporal.Instant.from(a.start), Temporal.Instant.from(b.start)));
  for (const event of sorted) {
    const zoned = Temporal.Instant.from(event.start).toZonedDateTimeISO(DEFAULT_TIME_ZONE);
    const dayKey = zoned.toPlainDate().toString();
    if (!byDay.has(dayKey)) byDay.set(dayKey, { dateLabel: zoned.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" }), events: [] });
    byDay.get(dayKey)!.events.push({
      time: event.allDay ? "" : timeFormatter.format(new Date(event.start)),
      label: event.summary, duration: eventDuration(event), location: event.location ?? null,
      people: peopleLabel(event), videoCall: Boolean(event.meetingLink), allDay: event.allDay,
    });
  }
  return { kind: "calendar_range", rangeLabel: window.label, count: events.length, insight: events.length ? `${events.length} event${events.length === 1 ? "" : "s"} ${window.label}.` : `Nothing on your calendar ${window.label}.`, days: [...byDay.values()] };
}
