import { Temporal } from "@js-temporal/polyfill";
import { askAboutTime, listCalendarForWindow } from "@/lib/agents/calendar";
import { TIME_UNAVAILABLE } from "@/lib/agents/time-interpreter";
import { interpretTimeForUser } from "@/lib/agents/time-interpreter-runtime";
import { searchPublicWeb, type PublicResearch } from "@/lib/tools/general/tavily-search";
import { calculateDrivingRoute } from "@/lib/tools/maps/routes";
import { loadLearnings } from "@/lib/learning/store";

type Outcome<T> = { ok: true; value: T } | { ok: false };

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export async function answerScheduleFeasibility(input: string, userId: string, context: { role: "user" | "assistant"; content: string }[] = []) {
  // R20.5: a model reads the day, the start time and the place; the code only checks their form.
  const reading = await interpretTimeForUser({ message: input, today: Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString(), timeZone: TIME_ZONE, userId, context });
  if (reading.kind === "unavailable") return TIME_UNAVAILABLE;
  if (reading.kind === "ask") return askAboutTime(reading.question, reading.choices);
  const window = reading.window;
  // A saved home location is the default place: it points the web search at nearby venues and gives a starting point for the drive.
  const learnings = await loadLearnings(userId).catch(() => undefined);
  const home = learnings?.homeLocation;
  const requestedLocation = reading.place ?? undefined;
  const [calendarResult, researchResult] = await Promise.all([
    settle(listCalendarForWindow(userId, window)),
    settle(searchPublicWeb(`${input}. Find the official date, start time, location, and runtime or duration.${home && !requestedLocation ? ` Look for venues near ${home}.` : ""}`)),
  ]);
  if (!calendarResult.ok && !researchResult.ok) throw new Error("FEASIBILITY_DEPENDENCIES_UNAVAILABLE");

  const events = calendarResult.ok ? calendarResult.value : [];
  const research = researchResult.ok ? researchResult.value : undefined;
  const requestedStart = reading.moment ?? undefined;
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
