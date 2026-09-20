import { describe, expect, it } from "vitest";
import { normalizeTimeFromEvidence } from "./calendar-time";

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
