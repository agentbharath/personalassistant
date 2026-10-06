import { assertToolAllowed } from "@/lib/agents/registry";
import { withGoogleCredential } from "@/lib/auth/google-credential-broker";
import { createHash } from "node:crypto";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  allDay: boolean;
  /** First names only, self excluded -- just enough to show who's in the meeting, never full addresses in a card.
   * Optional (defaults applied where read): most fixtures across the codebase predate this field and only care
   * about timing, not attendees. */
  attendeeNames?: string[];
  /** Guests invited but not named above, when there are more than attendeeNames keeps. */
  moreAttendeeCount?: number;
  meetingLink?: string | null;
  /** Plain text, HTML tags stripped, short -- the event's own notes/agenda when it has one. */
  description?: string | null;
};

export class GoogleCalendarAccessError extends Error {
  constructor(public readonly reason: "api_disabled" | "insufficient_scope" | "forbidden" | "unavailable") {
    super(`Google Calendar access failed: ${reason}`);
    this.name = "GoogleCalendarAccessError";
  }
}

export type CalendarEventCandidate = { summary: string; start: string; end: string; timeZone?: string | null; location?: string | null; attendees: string[]; description?: string | null };

export function calendarEventId(userId: string, candidate: CalendarEventCandidate) {
  return createHash("sha256").update(`${userId}|${candidate.summary}|${candidate.start}|${candidate.end}|${candidate.attendees.slice().sort().join(",")}`).digest("hex").slice(0, 32);
}

export async function createCalendarEvent(userId: string, candidate: CalendarEventCandidate) {
  assertToolAllowed("calendar", "calendar.create_event");
  return withGoogleCredential(userId, "calendar", async (accessToken) => {
    const stableId = calendarEventId(userId, candidate);
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("sendUpdates", candidate.attendees.length ? "all" : "none");
    const response = await resilientFetch("google_calendar", url, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ id: stableId, summary: candidate.summary, start: { dateTime: candidate.start, timeZone: candidate.timeZone || undefined }, end: { dateTime: candidate.end, timeZone: candidate.timeZone || undefined }, location: candidate.location || undefined, description: candidate.description || undefined, attendees: candidate.attendees.map((email) => ({ email })) }),
    }, { timeoutMs: 8_000, maxAttempts: 2 });
    if (response.status === 409) return { id: stableId, duplicate: true };
    if (!response.ok) throw new GoogleCalendarAccessError(response.status === 401 ? "insufficient_scope" : response.status === 403 ? "forbidden" : "unavailable");
    const body = await response.json() as { id?: string; htmlLink?: string };
    return { id: body.id ?? stableId, htmlLink: body.htmlLink, duplicate: false };
  });
}

export async function updateCalendarEventAttendees(userId: string, eventId: string, attendees: string[]) {
  assertToolAllowed("calendar", "calendar.update_event");
  return withGoogleCredential(userId, "calendar", async (accessToken) => {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", "all");
    const response = await resilientFetch("google_calendar", url, {
      method: "PATCH",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ attendees: attendees.map((email) => ({ email })) }),
    }, { timeoutMs: 8_000, maxAttempts: 2 });
    if (!response.ok) throw new GoogleCalendarAccessError(response.status === 401 ? "insufficient_scope" : response.status === 403 ? "forbidden" : "unavailable");
    return response.json() as Promise<{ id: string; htmlLink?: string }>;
  });
}

/** Approval-gated destructive tool. Call only from the calendar deletion workflow. */
export async function deleteApprovedCalendarEvent(userId: string, eventId: string) {
  assertToolAllowed("calendar", "calendar.delete_event_approved");
  return withGoogleCredential(userId, "calendar", async (accessToken) => {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", "all");
    const response = await resilientFetch("google_calendar", url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    }, { timeoutMs: 8_000, maxAttempts: 2 });
    // A retry after a successful deletion is safe and treated as complete.
    if (response.status === 404 || response.status === 410) return { alreadyDeleted: true };
    if (!response.ok) throw new GoogleCalendarAccessError(response.status === 401 ? "insufficient_scope" : response.status === 403 ? "forbidden" : "unavailable");
    return { alreadyDeleted: false };
  });
}

/** An event description can carry raw HTML (Google Meet notes, Zoom invites paste their own markup in). Strips tags
 * and entities down to a short, plain first line -- a card line, not the full agenda. */
function plainDescription(raw: string): string | null {
  const text = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 160) : null;
}

export async function listCalendarEvents(userId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  assertToolAllowed("calendar", "calendar.list_events");
  return withGoogleCredential(userId, "calendar", async (accessToken) => {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.search = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" }).toString();
    const response = await resilientFetch("google_calendar", url, { headers: { authorization: `Bearer ${accessToken}` } }, { timeoutMs: 8_000, maxAttempts: 2 });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }>; status?: string } } | null;
      const googleReason = errorBody?.error?.errors?.[0]?.reason;
      if (response.status === 403 && (googleReason === "accessNotConfigured" || googleReason === "serviceDisabled")) throw new GoogleCalendarAccessError("api_disabled");
      if (response.status === 401 || (response.status === 403 && googleReason === "insufficientPermissions")) throw new GoogleCalendarAccessError("insufficient_scope");
      if (response.status === 403) throw new GoogleCalendarAccessError("forbidden");
      throw new GoogleCalendarAccessError("unavailable");
    }
    const body = await response.json() as {
      items?: Array<{
        id?: string; summary?: string; location?: string; description?: string;
        start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
        attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean }>;
        hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
      }>;
    };
    return (body.items ?? []).flatMap((event) => {
      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;
      if (!event.id || !start || !end) return [];
      const guests = (event.attendees ?? []).filter((attendee) => !attendee.self && !attendee.resource);
      const names = guests.map((attendee) => (attendee.displayName || attendee.email?.split("@")[0] || "").trim()).filter(Boolean);
      const meetingLink = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || null;
      const description = event.description ? plainDescription(event.description) : null;
      return [{
        id: event.id, summary: event.summary ?? "Busy", start, end, location: event.location, allDay: Boolean(event.start?.date),
        attendeeNames: names.slice(0, 4), moreAttendeeCount: Math.max(0, names.length - 4), meetingLink, description,
      }];
    });
  });
}
