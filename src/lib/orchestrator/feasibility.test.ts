import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LEARNINGS, withLearning } from "@/lib/learning/learnings";

const mocks = vi.hoisted(() => ({
  learnings: null as unknown,
  search: vi.fn(),
  route: vi.fn(),
  reading: null as unknown,
}));

const start = Temporal.ZonedDateTime.from("2026-09-26T00:00:00-07:00[America/Los_Angeles]");

vi.mock("@/lib/agents/calendar", () => ({
  askAboutTime: (question: string) => question,
  listCalendarForWindow: async () => [],
}));
vi.mock("@/lib/agents/time-interpreter-runtime", () => ({
  interpretTimeForUser: async () => mocks.reading,
}));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: (...args: unknown[]) => mocks.search(...args) }));
vi.mock("@/lib/tools/maps/routes", () => ({ calculateDrivingRoute: (...args: unknown[]) => mocks.route(...args) }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: async () => mocks.learnings }));

import { answerScheduleFeasibility } from "./feasibility";

function reading(place: string | null) {
  return { kind: "window", window: { start, end: start.add({ days: 1 }), label: "on Saturday" }, moment: start.add({ hours: 14 }), place };
}

beforeEach(() => {
  mocks.reading = reading(null);
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
    mocks.reading = reading("AMC Bay Street");
    await answerScheduleFeasibility("can I catch a movie at AMC Bay Street Saturday at 2pm", "u1");
    expect(mocks.search.mock.calls[0][0]).not.toMatch(/near Oakland/);
  });

  it("adds the drive from home to the named place", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "home_location", place: "Oakland, CA" });
    mocks.reading = reading("AMC Bay Street");
    const answer = await answerScheduleFeasibility("can I catch a movie at AMC Bay Street Saturday at 2pm", "u1");
    expect(mocks.route).toHaveBeenCalledWith("Oakland, CA", "AMC Bay Street");
    expect(answer).toMatch(/about 25 minutes to drive from home \(Oakland, CA\) to AMC Bay Street/);
  });

  it("behaves as before with no home location saved", async () => {
    mocks.reading = reading("AMC Bay Street");
    const answer = await answerScheduleFeasibility("can I catch a movie at AMC Bay Street Saturday at 2pm", "u1");
    expect(mocks.search.mock.calls[0][0]).not.toMatch(/near /);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(answer).not.toMatch(/from home/);
  });

  it("asks, and looks nothing up, when the model is unsure of the time or is unavailable", async () => {
    mocks.reading = { kind: "ask", question: "Saturday the 26th or the 3rd?", choices: [] };
    expect(await answerScheduleFeasibility("movie saturday", "u1")).toBe("Saturday the 26th or the 3rd?");
    mocks.reading = { kind: "unavailable" };
    expect(await answerScheduleFeasibility("movie saturday", "u1")).toMatch(/AI model isn't available/);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
