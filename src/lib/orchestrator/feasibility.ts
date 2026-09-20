import { Temporal } from "@js-temporal/polyfill";
import { DateClarificationError, getCalendarWindow, listCalendarForWindow } from "@/lib/agents/calendar";
import { searchPublicWeb, type PublicResearch } from "@/lib/tools/general/tavily-search";
import { calculateDrivingRoute } from "@/lib/tools/maps/routes";
import { loadLearnings } from "@/lib/learning/store";

type Outcome<T> = { ok: true; value: T } | { ok: false };

export async function answerScheduleFeasibility(input: string, userId: string) {
  let window;
  try { window = getCalendarWindow(input); }
  catch (error) { if (error instanceof DateClarificationError) return error.question; throw error; }
  // A saved home location is the default place: it points the web search at nearby venues and gives a starting point for the drive.
  const learnings = await loadLearnings(userId).catch(() => undefined);
  const home = learnings?.homeLocation;
  const requestedLocation = extractLocation(input);
  const [calendarResult, researchResult] = await Promise.all([
    settle(listCalendarForWindow(userId, window)),
    settle(searchPublicWeb(`${input}. Find the official date, start time, location, and runtime or duration.${home && !requestedLocation ? ` Look for venues near ${home}.` : ""}`)),
  ]);
  if (!calendarResult.ok && !researchResult.ok) throw new Error("FEASIBILITY_DEPENDENCIES_UNAVAILABLE");

  const events = calendarResult.ok ? calendarResult.value : [];
  const research = researchResult.ok ? researchResult.value : undefined;
  const requestedStart = preciseStart(input, window.start);
  const durationMinutes = research ? extractDuration(research) : undefined;
  const nextEvent = requestedStart ? events.find((event) => !event.allDay && Temporal.Instant.compare(Temporal.Instant.from(event.start), requestedStart.toInstant()) >= 0) : undefined;

  let routeMinutes: number | undefined;
  if (requestedLocation && nextEvent?.location) {
    const route = await settle(calculateDrivingRoute(requestedLocation, nextEvent.location));
    if (route.ok) routeMinutes = route.value.durationMinutes;
  }
  let fromHomeMinutes: number | undefined;
  if (home && requestedLocation) {
    const leg = await settle(calculateDrivingRoute(home, requestedLocation));
    if (leg.ok) fromHomeMinutes = leg.value.durationMinutes;
  }

  const lines: string[] = [];
  if (research?.answer) lines.push(research.answer.trim());
  if (!calendarResult.ok) lines.push("I couldn’t read your calendar, so I can’t confirm conflicts.");
  else if (events.length === 0) lines.push(`Your calendar has no events ${window.label}.`);
  else if (requestedStart && durationMinutes && nextEvent) {
    // R14.1: a learned buffer (parking, walking in, running late) is added to the estimate.
    const bufferMinutes = learnings?.calendar.bufferMinutes ?? 0;
    const activityEnd = requestedStart.add({ minutes: durationMinutes + (routeMinutes ?? 0) + bufferMinutes });
    const nextStart = Temporal.Instant.from(nextEvent.start).toZonedDateTimeISO(window.start.timeZoneId);
    lines.push(Temporal.ZonedDateTime.compare(activityEnd, nextStart) <= 0
      ? `Yes—the activity should finish${routeMinutes ? ` with about ${routeMinutes} minutes of driving` : ""}${bufferMinutes ? `, plus your ${bufferMinutes}-minute buffer` : ""} before “${nextEvent.summary}.”`
      : `No—the estimated finish${bufferMinutes ? ` (with your ${bufferMinutes}-minute buffer)` : ""} overlaps “${nextEvent.summary}.”`);
  } else {
    const eventSummary = events.slice(0, 5).map((event) => `• ${event.summary}${event.location ? ` at ${event.location}` : ""}`).join("\n");
    if (eventSummary) lines.push(`Calendar events in that window:\n${eventSummary}`);
    const missing = [!requestedStart && "the activity start time", !durationMinutes && "its duration", !requestedLocation && "the activity location", nextEvent && !nextEvent.location && "the meeting location"].filter(Boolean);
    if (missing.length) lines.push(`To confirm travel feasibility, I still need ${missing.join(", ")}.`);
  }
  if (fromHomeMinutes && home && requestedLocation) lines.push(`It’s about ${fromHomeMinutes} minutes to drive from home (${home}) to ${requestedLocation}.`);
  if (research?.sources.length) lines.push(`Sources: ${research.sources.slice(0, 3).map((source) => `${source.title} (${source.url})`).join(" · ")}`);
  return lines.join("\n\n");
}

async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try { return { ok: true, value: await promise }; } catch { return { ok: false }; }
}

function extractDuration(research: PublicResearch) {
  const text = [research.answer, ...research.sources.map((source) => source.snippet)].join(" ");
  const hoursMinutes = text.match(/(\d+)\s*(?:hours?|hrs?)[, ]+(\d+)\s*(?:minutes?|mins?)/i);
  if (hoursMinutes) return Number(hoursMinutes[1]) * 60 + Number(hoursMinutes[2]);
  const minutes = text.match(/\b(\d{2,3})\s*(?:minutes?|mins?)\b/i);
  return minutes ? Number(minutes[1]) : undefined;
}

function preciseStart(input: string, date: Temporal.ZonedDateTime) {
  const match = input.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (!match) return undefined;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return date.with({ hour, minute: Number(match[2] ?? 0), second: 0, millisecond: 0 });
}

function extractLocation(input: string) {
  const match = input.match(/\b(?:at|in)\s+([^,]+?)(?=\s+(?:on|at)\s+(?:\w+\s+)?\d|\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|$)/i);
  const value = match?.[1]?.trim();
  if (!value || /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))$/i.test(value)) return undefined;
  return value;
}
