import { describe, expect, it, vi } from "vitest";
import { normalizeTimeFromEvidence } from "./calendar-time";

const mocks = vi.hoisted(() => ({ extractCalendarEvent: vi.fn() }));
vi.mock("@/lib/model/claude", () => ({ extractCalendarEvent: mocks.extractCalendarEvent }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: vi.fn(async () => ({ sources: [] })) }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: vi.fn(async () => ({ calendar: {} })) }));
vi.mock("@/lib/workflows/calendar-create", () => ({ createCalendarApproval: vi.fn() }));

describe("a malformed or truncated extraction degrades to a plain message (found live, R32)", () => {
  it("never crashes the request when extractCalendarEvent throws", async () => {
    mocks.extractCalendarEvent.mockRejectedValue(new SyntaxError("Unterminated string in JSON"));
    const { prepareCalendarCreate } = await import("./calendar-create");
    const answer = await prepareCalendarCreate("dentist appointment friday at 3", "u1", "c1");
    expect(answer).toMatch(/Nothing was created/);
  });
});

describe("calendar event source-time normalization", () => {
  it("corrects an AM extraction when the verified source says PM", () => {
    const result = normalizeTimeFromEvidence({
      start: "2026-11-07T14:00:00Z",
      end: "2026-11-07T16:00:00Z",
      timeZone: "America/Chicago",
    }, "Ticketmaster — Nov 7, 2026 at 8:00 PM — AT&T Stadium");

    expect(result.start).toBe("2026-11-08T02:00:00Z");
    expect(result.end).toBe("2026-11-08T04:00:00Z");
  });

  it("leaves a matching venue-local time unchanged", () => {
    const candidate = { start: "2026-11-08T02:00:00Z", end: "2026-11-08T04:00:00Z", timeZone: "America/Chicago" };
    expect(normalizeTimeFromEvidence(candidate, "Starts at 8:00 PM")).toEqual(candidate);
  });
});
