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

describe("a correction to a just-proposed event carries the prior proposal forward (found live, R33: \"make it only one hour\" had no title/start of its own and failed as underspecified)", () => {
  const fullEvent = { summary: "Discussion on Plaid Integration with Daylark", start: "2026-09-28T09:00:00-07:00", end: "2026-09-28T11:00:00-07:00", timeZone: "America/Los_Angeles", location: null, attendees: ["bharathkumarvaddineni5@gmail.com"], description: null, missingFields: [] };
  const priorReply = "### Review calendar event\n\n- **Event:** Discussion on Plaid Integration with Daylark\n- **Starts:** Sep 28, 2026, 9:00 AM\n- **Ends:** Sep 28, 2026, 11:00 AM\n- **Time zone:** America/Los_Angeles\n- **Guests:** bharathkumarvaddineni5@gmail.com\n\nChoose Confirm to create it and send invitations, or Cancel. This preview expires in 30 minutes.";

  it("passes the prior proposed event to extraction instead of leaving the correction to stand alone", async () => {
    mocks.extractCalendarEvent.mockResolvedValue({ ...fullEvent, end: "2026-09-28T10:00:00-07:00" });
    const { prepareCalendarCreate } = await import("./calendar-create");
    const answer = await prepareCalendarCreate("make it only one hour", "u1", "c1", [
      { role: "user", content: "schedule a meeting tomorrow with bharathkumarvaddineni5@gmail.com at 9 am for discussion on plaid integration with daylark" },
      { role: "assistant", content: priorReply },
    ]);
    expect(mocks.extractCalendarEvent).toHaveBeenCalledWith("make it only one hour", "", expect.any(String), "America/Los_Angeles", priorReply);
    expect(answer).not.toMatch(/reliable/);
    expect(answer).toContain("Discussion on Plaid Integration with Daylark");
  });

  it("does not treat an unrelated prior reply as a proposed event to correct", async () => {
    mocks.extractCalendarEvent.mockResolvedValue(fullEvent);
    const { prepareCalendarCreate } = await import("./calendar-create");
    await prepareCalendarCreate("make it only one hour", "u1", "c1", [
      { role: "user", content: "what's the weather" },
      { role: "assistant", content: "It's sunny." },
    ]);
    expect(mocks.extractCalendarEvent).toHaveBeenCalledWith("make it only one hour", "", expect.any(String), "America/Los_Angeles", null);
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
