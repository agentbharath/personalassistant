import type { CalendarEvent } from "@/lib/tools/calendar/google-calendar";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export function eventWhen(event: CalendarEvent, withDay: boolean) {
  if (event.allDay) return withDay ? `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${event.start}T00:00:00Z`))} · all day` : "All day";
  const date = new Date(event.start);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(date);
  return withDay ? `${new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" }).format(date)} · ${time}` : time;
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
