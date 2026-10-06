import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
const mocks = vi.hoisted(() => ({ interpretTime: vi.fn(), listEvents: vi.fn() }));
vi.mock("./time-interpreter-runtime", () => ({ interpretTimeForUser: mocks.interpretTime }));
vi.mock("@/lib/tools/calendar/google-calendar", async (importOriginal) => ({ ...(await importOriginal<object>()), listCalendarEvents: mocks.listEvents }));
import { GoogleCalendarAccessError } from "@/lib/tools/calendar/google-calendar";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { answerCalendar } from "./calendar";

const TZ = "America/Los_Angeles";
const window = (startISO: string, endISO: string, label: string) => ({ start: Temporal.ZonedDateTime.from(`${startISO}[${TZ}]`), end: Temporal.ZonedDateTime.from(`${endISO}[${TZ}]`), label });
const event = (id: string, summary: string, start: string, end: string, extra: Partial<{ attendeeNames: string[]; moreAttendeeCount: number; meetingLink: string | null; location: string }> = {}) => ({ id, summary, start, end, allDay: false, ...extra });

beforeEach(() => vi.clearAllMocks());

describe("a single day's worth of window gets the same timeline card as daily_view", () => {
  it("embeds a standalone card for a single day with events -- unlike daily_view's card, the whole answer is the card, so the UI must not also show the plain-text list below it", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T00:00:00", "2026-09-30T00:00:00", "tomorrow"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([event("1", "Design review", "2026-09-29T18:00:00Z", "2026-09-29T19:00:00Z")]);
    const answer = await answerCalendar("what's on my calendar tomorrow", "u1");
    expect(answer).toContain("Here’s your calendar tomorrow:"); // still present as the copy/older-client fallback text
    expect(answer).toContain("Design review");
    expect(answer).toContain("```daylark-card");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.kind).toBe("day");
    expect(card.standalone).toBe(true);
    expect(card.dateLabel).toBe("Tuesday, September 29");
    expect(card.count).toBe(1);
    expect(card.timeline.some((row: { label: string }) => row.label === "Design review")).toBe(true);
  });

  it("still embeds a card, reading 'tomorrow' rather than 'today', when there are no events at all", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T00:00:00", "2026-09-30T00:00:00", "tomorrow"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([]);
    const answer = await answerCalendar("what's on my calendar tomorrow", "u1");
    expect(answer).toContain("Your primary calendar has no events tomorrow.");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.insight).toBe("Nothing on your calendar tomorrow.");
    expect(card.count).toBe(0);
  });

  it("embeds a day-grouped calendar_range card for a genuinely multi-day range, with the plain list as its copy/older-client text", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-10-05T00:00:00", "next week"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([
      event("1", "Standup", "2026-09-29T16:00:00Z", "2026-09-29T16:15:00Z"),
      event("2", "1:1", "2026-10-01T18:00:00Z", "2026-10-01T18:30:00Z", { attendeeNames: ["Priya"] }),
    ]);
    const answer = await answerCalendar("what's on my calendar next week", "u1");
    expect(answer).toContain("Standup"); // plain-text fallback still present
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.kind).toBe("calendar_range");
    expect(card.count).toBe(2);
    expect(card.days).toHaveLength(2); // two distinct days, each its own group
    expect(card.days[0].dateLabel).toBe("Tue, Sep 29");
    expect(card.days[1].events[0]).toMatchObject({ label: "1:1", people: "Priya" });
  });

  it("still has no card for a single day with no events at all -- an empty week shouldn't invent day groups to show", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-10-05T00:00:00", "next week"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([]);
    const answer = await answerCalendar("what's on my calendar next week", "u1");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.days).toEqual([]);
    expect(card.insight).toBe("Nothing on your calendar next week.");
  });
});

describe("who's in a meeting and how to join it (found live: 'Invite 1 — Tue, Oct 6, 4:00 PM–5:00 PM' alone wasn't enough to tell a meeting apart from a placeholder)", () => {
  it("names attendees and flags a video call in the single-day card's timeline row", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T00:00:00", "2026-09-30T00:00:00", "tomorrow"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([event("1", "Design review", "2026-09-29T18:00:00Z", "2026-09-29T19:00:00Z", { attendeeNames: ["Sam", "Alex"], moreAttendeeCount: 2, meetingLink: "https://meet.google.com/abc" })]);
    const answer = await answerCalendar("what's on my calendar tomorrow", "u1");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    const row = card.timeline.find((r: { label: string }) => r.label === "Design review");
    expect(row.people).toBe("Sam, Alex +2");
    expect(row.videoCall).toBe(true);
  });

  it("adds the same detail to the plain-list fallback a multi-day range still uses", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-10-05T00:00:00", "next week"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([event("1", "Standup", "2026-09-29T16:00:00Z", "2026-09-29T16:15:00Z", { attendeeNames: ["Priya"], meetingLink: "https://meet.google.com/xyz" })]);
    const answer = await answerCalendar("what's on my calendar next week", "u1");
    expect(answer).toContain("Standup — Tue, Sep 29, 9:00 AM–9:15 AM with Priya");
  });
});

describe("existing behavior, not yet under test before this file existed", () => {
  it("asks about the time instead of guessing", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "ask", question: "Which day?", choices: ["today", "tomorrow"] });
    expect(await answerCalendar("what's on my calendar", "u1")).toBe("Which day? (today / tomorrow)");
  });

  it("says so, without guessing, when the model is unavailable", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "unavailable" });
    expect(await answerCalendar("what's on my calendar", "u1")).toMatch(/AI model isn't available/);
  });

  it("gives a specific, actionable message per Google Calendar failure reason", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T00:00:00", "2026-09-30T00:00:00", "tomorrow"), moment: null, place: null });
    mocks.listEvents.mockRejectedValue(new GoogleCalendarAccessError("insufficient_scope"));
    expect(await answerCalendar("what's on my calendar tomorrow", "u1")).toMatch(/Calendar read access/);
    mocks.listEvents.mockRejectedValue(new GoogleConnectionRequiredError("calendar"));
    expect(await answerCalendar("what's on my calendar tomorrow", "u1")).toMatch(/connection needs to be refreshed/);
  });
});
