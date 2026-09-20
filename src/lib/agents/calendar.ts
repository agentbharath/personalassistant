import { Temporal } from "@js-temporal/polyfill";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { GoogleCalendarAccessError, listCalendarEvents, type CalendarEvent } from "@/lib/tools/calendar/google-calendar";

const DEFAULT_TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export class DateClarificationError extends Error {
  constructor(public readonly question: string) { super(question); this.name = "DateClarificationError"; }
}

export async function answerCalendar(input: string, userId: string) {
  try {
    const window = getCalendarWindow(input);
    const events = await listCalendarForWindow(userId, window);
    if (events.length === 0) return `Your primary calendar has no events ${window.label}.`;
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const lines = events.map((event) => {
      if (event.allDay) return `• ${event.summary} — all day${event.location ? ` at ${event.location}` : ""}`;
      const start = formatter.format(new Date(event.start));
      const end = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(event.end));
      return `• ${event.summary} — ${start}–${end}${event.location ? ` at ${event.location}` : ""}`;
    });
    return `Here’s your calendar ${window.label}:\n${lines.join("\n")}`;
  } catch (error) {
    if (error instanceof DateClarificationError) return error.question;
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

export type CalendarWindow = { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime; label: string };

export function getCalendarWindow(input: string, timeZone = DEFAULT_TIME_ZONE): CalendarWindow {
  const now = Temporal.Now.zonedDateTimeISO(timeZone);
  const normalized = input.toLowerCase();
  let date = now.toPlainDate();
  let label = "today";
  let rangeDays = 1;
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthPattern = monthNames.map((month) => `${month}|${month.slice(0, 3)}`).join("|");
  const explicitDate = normalized.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  const nextDays = normalized.match(/next\s+(\d{1,2})\s+days?/);
  if (nextDays) {
    rangeDays = Math.min(Number(nextDays[1]), 31);
    label = `over the next ${rangeDays} days`;
  } else if (explicitDate) {
    const month = monthNames.findIndex((name) => name === explicitDate[1] || name.startsWith(explicitDate[1].slice(0, 3))) + 1;
    const yearWasProvided = Boolean(explicitDate[3]);
    date = Temporal.PlainDate.from({ year: Number(explicitDate[3] ?? now.year), month, day: Number(explicitDate[2]) });
    if (!yearWasProvided && Temporal.PlainDate.compare(date, now.toPlainDate()) < 0) {
      throw new DateClarificationError(`${explicitDate[1]} ${explicitDate[2]} has already passed this year. Which year did you mean?`);
    }
    label = `on ${date.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  } else if (normalized.includes("next week")) {
    rangeDays = 7;
    label = "over the next week";
  } else if (normalized.includes("tomorrow")) {
    date = date.add({ days: 1 });
    label = "tomorrow";
  } else {
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const weekdayIndex = weekdays.findIndex((weekday) => normalized.includes(weekday));
    if (weekdayIndex >= 0) {
      const targetDay = weekdayIndex + 1;
      const delta = (targetDay - now.dayOfWeek + 7) % 7;
      date = date.add({ days: delta });
      label = `on ${weekdays[weekdayIndex]}`;
    }
  }
  const startHour = normalized.includes("afternoon") ? 12 : 0;
  const endHour = normalized.includes("afternoon") ? 18 : 24;
  const start = date.toZonedDateTime({ timeZone, plainTime: { hour: startHour } });
  const end = rangeDays > 1
    ? date.add({ days: rangeDays }).toZonedDateTime({ timeZone, plainTime: { hour: 0 } })
    : endHour === 24
      ? date.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: { hour: 0 } })
      : date.toZonedDateTime({ timeZone, plainTime: { hour: endHour } });
  return { start, end, label };
}

export function listCalendarForWindow(userId: string, window: CalendarWindow): Promise<CalendarEvent[]> {
  return listCalendarEvents(userId, window.start.toInstant().toString(), window.end.toInstant().toString());
}
