import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { loadLearnings } from "@/lib/learning/store";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { searchPublicWeb } from "@/lib/tools/general/tavily-search";
import { extractCalendarEvent } from "@/lib/model/claude";
import { createCalendarApproval } from "@/lib/workflows/calendar-create";
import { DEFAULT_EVENT_MINUTES, normalizeTimeFromEvidence } from "./calendar-time";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const candidateSchema = z.object({ summary: z.string().min(1), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), timeZone: z.string().min(1).nullable(), location: z.string().nullable(), attendees: z.array(z.string().email()).max(20), description: z.string().nullable() });

export async function prepareCalendarCreate(input: string, userId: string, conversationId?: string) {
  if (!conversationId) return "I need a saved conversation before I can create an approval preview.";
  const needsResearch = /\b(find|look up|concert|show|game|public event)\b/i.test(input);
  const isTicketedEvent = /\b(concert|show|game|festival|tour)\b/i.test(input);
  const focusedResearch = needsResearch ? await searchPublicWeb(buildEventResearchQuery(input), isTicketedEvent ? { domains: ["ticketmaster.com", "seatgeek.com", "axs.com"] } : {}) : { sources: [] };
  const research = needsResearch && focusedResearch.sources.length === 0
    ? await searchPublicWeb(buildEventResearchQuery(input))
    : focusedResearch;
  const evidence = research.sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet}\n${source.url}`).join("\n\n");
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
  const extracted = await extractCalendarEvent(input, evidence, today, TIME_ZONE);
  // R14.1: a learned default length applies only when the event has no end or length of its own.
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const learnedMinutes = learnings.calendar.durationMinutes;
  const defaultMinutes = learnedMinutes ?? DEFAULT_EVENT_MINUTES;
  const usedLearnedLength = !extracted.end && learnedMinutes !== undefined;
  const normalized = normalizeTimeFromEvidence({ ...extracted, end: extracted.end ?? defaultEventEnd(extracted.start, defaultMinutes) }, evidence, defaultMinutes);
  const parsed = candidateSchema.safeParse(normalized);
  const requiredMissing = extracted.missingFields.filter((field) => ["summary", "title", "start", "start_time", "date", "time", "year"].includes(field));
  if (!parsed.success || requiredMissing.length) {
    const missing = requiredMissing.length ? friendlyMissingFields(requiredMissing) : "date, time, or title";
    return `I need a reliable ${missing} before I can prepare the calendar event. Nothing was created.`;
  }
  await createCalendarApproval(userId, conversationId, parsed.data);
  const event = parsed.data;
  const eventTimeZone = event.timeZone ?? TIME_ZONE;
  return `### Review calendar event\n\n- **Event:** ${event.summary}\n- **Starts:** ${formatDate(event.start, eventTimeZone)}\n- **Ends:** ${formatDate(event.end, eventTimeZone)}${usedLearnedLength ? ` (your usual ${learnedMinutes}-minute length)` : ""}\n- **Time zone:** ${eventTimeZone}${event.location ? `\n- **Location:** ${event.location}` : ""}${event.attendees.length ? `\n- **Guests:** ${event.attendees.join(", ")}` : ""}\n\nChoose **Confirm** to create it${event.attendees.length ? " and send invitations" : ""}, or **Cancel**. This preview expires in 30 minutes.`;
}

function formatDate(value: string, timeZone: string) { return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function defaultEventEnd(start: string | null, minutes: number) { return start ? new Date(new Date(start).getTime() + minutes * 60_000).toISOString() : null; }

function buildEventResearchQuery(input: string) {
  const withoutEmail = input.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ");
  const eventOnly = withoutEmail
    .replace(/^(?:ok(?:ay)?[,.]?\s*)/i, "")
    .split(/\s+and\s+(?:make|create|add|put|schedule)\b/i)[0]
    .replace(/\b(?:make|create|add|put|schedule)\s+(?:a|an|the)?\s*(?:calendar\s+)?(?:event|invite|invitation)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${eventOnly} official date start time venue`;
}

function friendlyMissingFields(fields: string[]) {
  const labels = fields.map((field) => ({ start_time: "start time", start: "start time", end_time: "end time", end: "end time", title: "event title", summary: "event title", year: "year" })[field] ?? field.replaceAll("_", " "));
  return [...new Set(labels)].join(" and ");
}
