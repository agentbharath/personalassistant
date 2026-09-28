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
const event = (id: string, summary: string, start: string, end: string) => ({ id, summary, start, end, allDay: false });

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

  it("does not embed a card for a genuinely multi-day range -- there's no design for that yet, so it keeps the plain list", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-10-05T00:00:00", "next week"), moment: null, place: null });
    mocks.listEvents.mockResolvedValue([event("1", "Standup", "2026-09-29T16:00:00Z", "2026-09-29T16:15:00Z")]);
    const answer = await answerCalendar("what's on my calendar next week", "u1");
    expect(answer).toContain("Standup");
    expect(answer).not.toContain("daylark-card");
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
