import { Temporal } from "@js-temporal/polyfill";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { embedCard } from "@/lib/chat/card-payload";
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
    // A timeline card only for a single day's worth of window -- the same visual language as the daily_view day
    // card, since this is the same "what does a day of meetings look like" question, just for an arbitrary day
    // instead of specifically today. A genuinely multi-day range ("next week") has no equivalent design yet, so
    // it keeps the plain list above rather than faking a richer view the mockup never specified.
    if (window.start.until(window.end, { largestUnit: "hours" }).hours > 25) return text;
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

function renderEventList(window: CalendarWindow, events: CalendarEvent[]): string {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const lines = events.map((event) => {
    if (event.allDay) return `• ${event.summary} — all day${event.location ? ` at ${event.location}` : ""}`;
    const start = formatter.format(new Date(event.start));
    const end = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(event.end));
    return `• ${event.summary} — ${start}–${end}${event.location ? ` at ${event.location}` : ""}`;
  });
  return `Here’s your calendar ${window.label}:\n${lines.join("\n")}`;
}

const windowDateLabel = (window: CalendarWindow) => window.start.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
