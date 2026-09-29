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
  return `${hour}:${String(zdt.minute).padStart(2, "0")} ${zdt.hour < 12 ? "AM" : "PM"}`;
};
const minutesBetween = (from: string, to: string) => Math.round((Temporal.Instant.from(to).epochMilliseconds - Temporal.Instant.from(from).epochMilliseconds) / 60_000);
const duration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  return hours ? `${hours} hr` : `${rest} min`;
};

function dayInsight(timed: CalendarEvent[], longestGap: { from: string; to: string; minutes: number } | null, dayWord: string): string {
  if (!timed.length) return `Nothing timed on your calendar ${dayWord}.`;
  let end = "", busy = 0;
  for (const event of timed) {
    const start = end && Temporal.Instant.compare(end, event.start) > 0 ? end : event.start;
    busy += Math.max(0, minutesBetween(start, event.end));
    if (!end || Temporal.Instant.compare(event.end, end) > 0) end = event.end;
  }
  return `${duration(busy)} scheduled.${longestGap ? ` Longest break between events: ${clock(longestGap.from)}–${clock(longestGap.to)} (${duration(longestGap.minutes)}).` : ""}`;
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
  const timed = events.filter((event) => !event.allDay).sort((a, b) => Temporal.Instant.compare(a.start, b.start));
  const allDay = events.filter((event) => event.allDay);

  const timeline: DayCardPayload["timeline"] = allDay.map((event) => ({ time: "", label: event.summary, duration: null, kind: "allday", startingIn: null, past: false, location: event.location ?? null }));

  let longestGap: { from: string; to: string; minutes: number } | null = null;
  let busyEnd = "";
  timed.forEach((event, index) => {
    const minutesUntilStart = minutesBetween(now, event.start);
    const startingIn = minutesUntilStart > 0 && minutesUntilStart <= SOON_WINDOW_MIN ? `in ${minutesUntilStart} min` : null;
    timeline.push({ time: clock(event.start), label: event.summary, duration: duration(minutesBetween(event.start, event.end)), kind: "meeting", startingIn, past: Temporal.Instant.compare(event.end, now) <= 0, location: event.location ?? null });
    if (!busyEnd || Temporal.Instant.compare(event.end, busyEnd) > 0) busyEnd = event.end;
    const next = timed[index + 1];
    if (!next) return;
    const gapMinutes = minutesBetween(busyEnd, next.start);
    if (gapMinutes < FOCUS_THRESHOLD_MIN) return;
    timeline.push({ time: clock(busyEnd), label: "Free", duration: duration(gapMinutes), kind: "free", startingIn: null, past: Temporal.Instant.compare(next.start, now) <= 0, location: null });
    if (!longestGap || gapMinutes > longestGap.minutes) longestGap = { from: busyEnd, to: next.start, minutes: gapMinutes };
  });

  const localNow = Temporal.Instant.from(now).toZonedDateTimeISO(TIME_ZONE);
  const sameDay = timed.some(event => Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE).toPlainDate().equals(localNow.toPlainDate()));
  let markerIndex = timeline.findIndex(row => row.kind !== "allday" && !row.past);
  // A break in progress comes before the snapshot marker; the next event comes after it.
  if (markerIndex >= 0 && timeline[markerIndex].kind === "free") markerIndex++;
  const nowMarker = sameDay ? { index: markerIndex < 0 ? timeline.length : markerIndex, label: clock(now) } : undefined;
  return { kind: "day", dateLabel, count: events.length, insight: events.length ? dayInsight(timed, longestGap, dayWord) : `Nothing on your calendar ${dayWord}.`, timeline, standalone, nowMarker, asOf: clock(now) };
}

/** Null when meetings couldn't load (needs_connection/unavailable) -- the surrounding markdown already explains why, so the card just doesn't add a broken one on top. */
export function buildDayCard(view: DailyView, now: string = Temporal.Now.instant().toString()): DayCardPayload | null {
  if (view.meetingsToday.state !== "ok") return null;
  const dateLabel = Temporal.PlainDate.from(view.today).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return buildTimelineCard(view.meetingsToday.value, dateLabel, now);
}
