import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";

vi.mock("../../auth/google-credential-broker", () => ({
  withGoogleCredential: vi.fn(async (_userId: string, capability: string, operation: (token: string) => Promise<unknown>) => {
    if (capability !== "calendar") throw new Error("wrong capability");
    return operation("calendar-token");
  }),
}));

import { listCalendarEvents } from "./google-calendar";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

/** Found live: "Invite 1 — Tue, Oct 6, 4:00 PM–5:00 PM" alone wasn't enough to tell a meeting apart from a
 * placeholder -- Google Calendar's own event already carries who's coming and how to join; this just wasn't being
 * read out of the API response at all. */
describe("reading who's in a meeting and how to join it, straight from the event Google already returns", () => {
  const respond = (items: unknown[]) => { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items }), { status: 200 })); vi.stubGlobal("fetch", fetch); return fetch; };

  it("names up to 4 attendees, excludes the signed-in person and any room/resource, and counts the rest", async () => {
    respond([{
      id: "1", summary: "Planning", start: { dateTime: "2026-10-06T16:00:00Z" }, end: { dateTime: "2026-10-06T17:00:00Z" },
      attendees: [
        { email: "me@example.com", self: true },
        { email: "room-5@resource.calendar.google.com", resource: true },
        { displayName: "Sam Lee", email: "sam@example.com" },
        { email: "no-name@example.com" },
        { displayName: "Alex", email: "alex@example.com" },
        { displayName: "Priya", email: "priya@example.com" },
        { displayName: "Jo", email: "jo@example.com" },
      ],
    }]);
    const [event] = await listCalendarEvents("u1", "2026-10-06T00:00:00Z", "2026-10-07T00:00:00Z");
    expect(event.attendeeNames).toEqual(["Sam Lee", "no-name", "Alex", "Priya"]);
    expect(event.moreAttendeeCount).toBe(1);
  });

  it("prefers the dedicated hangoutLink, falls back to a conferenceData video entry point, and is null with neither", async () => {
    respond([
      { id: "1", summary: "A", start: { dateTime: "2026-10-06T16:00:00Z" }, end: { dateTime: "2026-10-06T17:00:00Z" }, hangoutLink: "https://meet.google.com/abc", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://zoom.example/ignored" }] } },
      { id: "2", summary: "B", start: { dateTime: "2026-10-06T18:00:00Z" }, end: { dateTime: "2026-10-06T19:00:00Z" }, conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:123" }, { entryPointType: "video", uri: "https://zoom.example/xyz" }] } },
      { id: "3", summary: "C", start: { dateTime: "2026-10-06T20:00:00Z" }, end: { dateTime: "2026-10-06T21:00:00Z" } },
    ]);
    const [a, b, c] = await listCalendarEvents("u1", "2026-10-06T00:00:00Z", "2026-10-07T00:00:00Z");
    expect(a.meetingLink).toBe("https://meet.google.com/abc");
    expect(b.meetingLink).toBe("https://zoom.example/xyz");
    expect(c.meetingLink).toBeNull();
  });

  it("strips HTML out of the description down to a short plain line, and is null when there is none", async () => {
    respond([
      { id: "1", summary: "A", start: { dateTime: "2026-10-06T16:00:00Z" }, end: { dateTime: "2026-10-06T17:00:00Z" }, description: "<b>Agenda:</b> review Q4&nbsp;goals &amp; budget<br>See doc" },
      { id: "2", summary: "B", start: { dateTime: "2026-10-06T18:00:00Z" }, end: { dateTime: "2026-10-06T19:00:00Z" } },
    ]);
    const [a, b] = await listCalendarEvents("u1", "2026-10-06T00:00:00Z", "2026-10-07T00:00:00Z");
    expect(a.description).toBe("Agenda: review Q4 goals & budget See doc");
    expect(b.description).toBeNull();
  });
});
