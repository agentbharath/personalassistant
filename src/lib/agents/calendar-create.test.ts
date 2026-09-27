import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTimeFromEvidence } from "./calendar-time";

const mocks = vi.hoisted(() => ({ extractCalendarEvent: vi.fn(), loadPendingCalendarCreate: vi.fn() }));
vi.mock("@/lib/model/claude", () => ({ extractCalendarEvent: mocks.extractCalendarEvent }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: vi.fn(async () => ({ sources: [] })) }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: vi.fn(async () => ({ calendar: {} })) }));
vi.mock("@/lib/workflows/calendar-create", () => ({ createCalendarApproval: vi.fn(), loadPendingCalendarCreate: mocks.loadPendingCalendarCreate }));
beforeEach(() => { mocks.loadPendingCalendarCreate.mockReset().mockResolvedValue(null); });

describe("a malformed or truncated extraction degrades to a plain message (found live, R32)", () => {
  it("never crashes the request when extractCalendarEvent throws", async () => {
    mocks.extractCalendarEvent.mockRejectedValue(new SyntaxError("Unterminated string in JSON"));
    const { prepareCalendarCreate } = await import("./calendar-create");
    const answer = await prepareCalendarCreate("dentist appointment friday at 3", "u1", "c1");
    expect(answer).toMatch(/Nothing was created/);
  });
});

describe("a correction to a just-proposed event carries the open approval's exact candidate forward (found live, R33: \"make it only one hour\" had no title/start of its own and failed as underspecified)", () => {
  const pendingCandidate = { summary: "Discussion on Plaid Integration with Daylark", start: "2026-09-28T09:00:00-07:00", end: "2026-09-28T11:00:00-07:00", timeZone: "America/Los_Angeles", location: null, attendees: ["bharathkumarvaddineni5@gmail.com"], description: null };
  const fullEvent = { ...pendingCandidate, missingFields: [] };

  it("passes the open approval's stored candidate to extraction instead of leaving the correction to stand alone", async () => {
    mocks.loadPendingCalendarCreate.mockResolvedValueOnce(pendingCandidate);
    mocks.extractCalendarEvent.mockResolvedValue({ ...fullEvent, end: "2026-09-28T10:00:00-07:00" });
    const { prepareCalendarCreate } = await import("./calendar-create");
    const answer = await prepareCalendarCreate("make it only one hour", "u1", "c1");
    expect(mocks.extractCalendarEvent).toHaveBeenCalledWith("make it only one hour", "", expect.any(String), "America/Los_Angeles", JSON.stringify(pendingCandidate));
    expect(answer).not.toMatch(/reliable/);
    expect(answer).toContain("Discussion on Plaid Integration with Daylark");
  });

  it("passes null when there is no open approval to correct", async () => {
    mocks.loadPendingCalendarCreate.mockResolvedValueOnce(null);
    mocks.extractCalendarEvent.mockResolvedValue(fullEvent);
    const { prepareCalendarCreate } = await import("./calendar-create");
    await prepareCalendarCreate("dentist appointment friday at 3", "u1", "c1");
    expect(mocks.extractCalendarEvent).toHaveBeenCalledWith("dentist appointment friday at 3", "", expect.any(String), "America/Los_Angeles", null);
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
