import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "@/lib/tools/calendar/google-calendar";
import type { DayCardPayload } from "@/lib/chat/card-payload";
import type { DailyView } from "./load";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
/** A gap shorter than this between two meetings isn't worth calling out as "Free" -- it reads as noise, not a usable block. */
const FOCUS_THRESHOLD_MIN = 60;
const SOON_WINDOW_MIN = 60;

const clock = (iso: string) => {
  const zdt = Temporal.Instant.from(iso).toZonedDateTimeISO(TIME_ZONE);
  const hour = zdt.hour % 12 === 0 ? 12 : zdt.hour % 12;
  return `${hour}:${String(zdt.minute).padStart(2, "0")}`;
};
const minutesBetween = (from: string, to: string) => Math.round((Temporal.Instant.from(to).epochMilliseconds - Temporal.Instant.from(from).epochMilliseconds) / 60_000);
const duration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  return hours ? `${hours} hr` : `${rest} min`;
};

/** Whether an event overlaps the [fromHour,toHour) window on its own calendar day, for a morning/afternoon read. */
function overlapsHours(event: CalendarEvent, fromHour: number, toHour: number): boolean {
  const start = Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE);
  const end = Temporal.Instant.from(event.end).toZonedDateTimeISO(TIME_ZONE);
  const windowStart = start.with({ hour: fromHour, minute: 0 });
  const windowEnd = start.with({ hour: toHour, minute: 0 });
  return Temporal.ZonedDateTime.compare(start, windowEnd) < 0 && Temporal.ZonedDateTime.compare(end, windowStart) > 0;
}

/** `dayWord` names the day in a sentence ("today", "tomorrow", "Friday evening", ...) -- "today" for the
 * daily_view card, whatever the resolved window's own label says for an arbitrary calendar_query day. */
function dayInsight(timed: CalendarEvent[], longestGap: { from: string; to: string; minutes: number } | null, dayWord: string): string {
  if (!timed.length) return `Nothing on your calendar ${dayWord}.`;
  const morning = timed.some((event) => overlapsHours(event, 0, 12));
  const afternoon = timed.some((event) => overlapsHours(event, 12, 18));
  const lead = morning && afternoon ? "Busy most of the day." : morning ? "Busy morning, open afternoon." : afternoon ? "Open morning, busy afternoon." : `Mostly open ${dayWord}.`;
  const focus = longestGap ? ` Your longest focus block is ${clock(longestGap.from)} to ${clock(longestGap.to)}.` : timed.length > 1 ? " Back-to-back most of the day." : "";
  return `${lead}${focus}`;
}

/**
 * The shared timeline builder behind both the daily_view day card (today's meetings specifically) and the
 * calendar_query day card (any single day the person asks about) -- one visual language for "what does a day of
 * meetings look like," regardless of which day or which operation asked. `dateLabel` is the caller's own display
 * label (e.g. "Monday, September 28" or a resolved window's own label), since only the caller knows which day
 * this is and how it should read in its own context.
 */
export function buildTimelineCard(events: CalendarEvent[], dateLabel: string, now: string = Temporal.Now.instant().toString(), options: { dayWord?: string; standalone?: boolean } = {}): DayCardPayload {
  const { dayWord = "today", standalone = false } = options;
  const timed = events.filter((event) => !event.allDay).sort((a, b) => (a.start < b.start ? -1 : 1));
  const allDay = events.filter((event) => event.allDay);

  const timeline: DayCardPayload["timeline"] = allDay.map((event) => ({ time: "", label: event.summary, duration: null, kind: "allday", startingIn: null, past: false, location: event.location ?? null }));

  let longestGap: { from: string; to: string; minutes: number } | null = null;
  timed.forEach((event, index) => {
    const minutesUntilStart = minutesBetween(now, event.start);
    const startingIn = minutesUntilStart > 0 && minutesUntilStart <= SOON_WINDOW_MIN ? `in ${minutesUntilStart} min` : null;
    timeline.push({ time: clock(event.start), label: event.summary, duration: duration(minutesBetween(event.start, event.end)), kind: "meeting", startingIn, past: event.end < now, location: event.location ?? null });
    const next = timed[index + 1];
    if (!next) return;
    const gapMinutes = minutesBetween(event.end, next.start);
    if (gapMinutes < FOCUS_THRESHOLD_MIN) return;
    timeline.push({ time: clock(event.end), label: "Free", duration: duration(gapMinutes), kind: "free", startingIn: null, past: next.start < now, location: null });
    if (!longestGap || gapMinutes > longestGap.minutes) longestGap = { from: event.end, to: next.start, minutes: gapMinutes };
  });

  return { kind: "day", dateLabel, count: events.length, insight: dayInsight(timed, longestGap, dayWord), timeline, standalone };
}

/** Null when meetings couldn't load (needs_connection/unavailable) -- the surrounding markdown already explains why, so the card just doesn't add a broken one on top. */
export function buildDayCard(view: DailyView, now: string = Temporal.Now.instant().toString()): DayCardPayload | null {
  if (view.meetingsToday.state !== "ok") return null;
  const dateLabel = Temporal.PlainDate.from(view.today).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return buildTimelineCard(view.meetingsToday.value, dateLabel, now);
}
