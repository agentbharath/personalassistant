import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LEARNINGS, withLearning } from "@/lib/learning/learnings";

const mocks = vi.hoisted(() => ({
  learnings: null as unknown,
  search: vi.fn(),
  route: vi.fn(),
}));

const start = Temporal.ZonedDateTime.from("2026-09-26T00:00:00-07:00[America/Los_Angeles]");

vi.mock("@/lib/agents/calendar", () => ({
  DateClarificationError: class extends Error {},
  getCalendarWindow: () => ({ start, end: start.add({ days: 1 }), label: "on Saturday", timeZoneId: "America/Los_Angeles" }),
  listCalendarForWindow: async () => [],
}));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: (...args: unknown[]) => mocks.search(...args) }));
vi.mock("@/lib/tools/maps/routes", () => ({ calculateDrivingRoute: (...args: unknown[]) => mocks.route(...args) }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: async () => mocks.learnings }));

import { answerScheduleFeasibility } from "./feasibility";

beforeEach(() => {
  mocks.learnings = NO_LEARNINGS;
  mocks.search.mockReset().mockResolvedValue({ answer: "The film runs 120 minutes.", sources: [] });
  mocks.route.mockReset().mockResolvedValue({ durationMinutes: 25 });
});

describe("the saved home location in movie and travel answers", () => {
  it("points the search at the area around home when the message names no place", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "home_location", place: "Oakland, CA" });
    await answerScheduleFeasibility("can I catch a movie Saturday at 2pm", "u1");
    expect(mocks.search.mock.calls[0][0]).toMatch(/near Oakland, CA/);
  });

  it("does not add the home area when the message already names a place", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "home_location", place: "Oakland, CA" });
    await answerScheduleFeasibility("can I catch a movie at AMC Bay Street Saturday at 2pm", "u1");
    expect(mocks.search.mock.calls[0][0]).not.toMatch(/near Oakland/);
  });

  it("adds the drive from home to the named place", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "home_location", place: "Oakland, CA" });
    const answer = await answerScheduleFeasibility("can I catch a movie at AMC Bay Street Saturday at 2pm", "u1");
    expect(mocks.route).toHaveBeenCalledWith("Oakland, CA", "AMC Bay Street");
    expect(answer).toMatch(/about 25 minutes to drive from home \(Oakland, CA\) to AMC Bay Street/);
  });

  it("behaves as before with no home location saved", async () => {
    const answer = await answerScheduleFeasibility("can I catch a movie at AMC Bay Street Saturday at 2pm", "u1");
    expect(mocks.search.mock.calls[0][0]).not.toMatch(/near /);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(answer).not.toMatch(/from home/);
  });
});
