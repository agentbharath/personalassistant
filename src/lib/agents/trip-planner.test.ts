import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LEARNINGS, withLearning } from "@/lib/learning/learnings";

const mocks = vi.hoisted(() => ({
  learnings: null as unknown,
  search: vi.fn(),
  route: vi.fn(),
  reading: null as unknown,
  events: [] as unknown[],
  complete: vi.fn(),
  models: { fast: "claude-haiku-4-5-20251001", high: "claude-haiku-4-5-20251001" } as Record<"fast" | "high", string>,
}));

const start = Temporal.ZonedDateTime.from("2026-11-26T00:00:00-07:00[America/Denver]");

vi.mock("./calendar", () => ({
  askAboutTime: (question: string, choices: string[]) => (choices.length ? `${question} (${choices.join(" / ")})` : question),
  listCalendarForWindow: async () => mocks.events,
}));
vi.mock("./time-interpreter-runtime", () => ({ interpretTimeForUser: async () => mocks.reading }));
vi.mock("@/lib/tools/general/tavily-search", () => ({ searchPublicWeb: (...args: unknown[]) => mocks.search(...args) }));
vi.mock("@/lib/tools/maps/routes", () => ({ calculateDrivingRoute: (...args: unknown[]) => mocks.route(...args) }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: async () => mocks.learnings }));
vi.mock("@/lib/runtime/query-budget", () => ({ prepareAgentStage: () => undefined, configuredModel: (tier: "fast" | "balanced" | "high") => mocks.models[tier === "balanced" ? "high" : tier] }));

import { buildTripSpec, critiqueItinerary, runTripPlan, type Itinerary, type TripPlannerDeps, type TripSpec } from "./trip-planner";

const deps: TripPlannerDeps = { complete: (...args) => mocks.complete(...args) };
const plan = (destination: string, dateText: string, userId = "u1") => runTripPlan(destination, dateText, userId, [], deps);

const windowReading = () => ({ kind: "window" as const, window: { start, end: start.add({ days: 3 }), label: "over Thanksgiving weekend" }, moment: null, place: null });
const source = (n: number) => ({ title: `Guide ${n}`, url: `https://example.com/${n}`, snippet: `Evidence ${n}` });
const modelReply = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const candidates = { candidates: [{ name: "Rocky Mountain hike", category: "activity", detail: "a short, flat loop with mountain views", dated: false, eventDateNote: "", source: 1 }, { name: "Green Table diner", category: "food", detail: "known for its green chile", dated: false, eventDateNote: "", source: 2 }] };
const itinerary = (over: Partial<Itinerary> = {}): Itinerary => ({
  summary: "A relaxed long weekend in Colorado.", assumptions: ["Party of 1 (not stated)"],
  days: [
    { date: "2026-11-26", label: "Thu, Nov 26", stops: [{ time: "10:00 AM", name: "Rocky Mountain hike", reason: "a short, flat loop with mountain views", source: 1 }] },
    { date: "2026-11-27", label: "Fri, Nov 27", stops: [{ time: "12:00 PM", name: "Green Table diner", reason: "known for its green chile", source: 2 }] },
    { date: "2026-11-28", label: "Sat, Nov 28", stops: [{ time: "9:00 AM", name: "Rocky Mountain hike", reason: "back for the view at a different time of day", source: 1 }] },
  ],
  logistics: "Rent a car; downtown is walkable but the trailheads are not.", caveat: "",
  ...over,
});

beforeEach(() => {
  mocks.reading = windowReading();
  mocks.learnings = NO_LEARNINGS;
  mocks.events = [];
  mocks.models = { fast: "claude-haiku-4-5-20251001", high: "claude-haiku-4-5-20251001" };
  mocks.search.mockReset().mockResolvedValue({ answer: "", sources: [source(1), source(2)] });
  mocks.route.mockReset().mockResolvedValue({ durationMinutes: 90, distanceMeters: 145000 });
  mocks.complete.mockReset().mockImplementation(async (operation: string) => {
    if (operation === "trip_candidate_extraction") return modelReply(candidates);
    if (operation === "trip_itinerary_composition") return modelReply(itinerary());
    throw new Error(`unexpected operation ${operation}`);
  });
});

describe("building the trip spec (R32)", () => {
  it("resolves the date phrase through the same model-based time interpreter every other date reference uses, never a new parser", async () => {
    const outcome = await buildTripSpec("Colorado", "this upcoming Thanksgiving weekend", "u1");
    expect(outcome.kind).toBe("spec");
    if (outcome.kind !== "spec") throw new Error("expected a spec");
    expect(outcome.spec.destination).toBe("Colorado");
    expect(outcome.spec.start.toString()).toBe("2026-11-26");
    expect(outcome.spec.dateStatus).toBe("stated");
  });

  it("marks origin, party size and pace as assumed, never silently presented as stated, when not actually said", async () => {
    const outcome = await buildTripSpec("Colorado", "this upcoming Thanksgiving weekend", "u1");
    if (outcome.kind !== "spec") throw new Error("expected a spec");
    expect(outcome.spec.origin).toBeNull();
    expect(outcome.spec.originStatus).toBe("missing");
    expect(outcome.spec.partyStatus).toBe("assumed");
    expect(outcome.spec.paceStatus).toBe("assumed");
  });

  it("reads the saved home location as the origin, exactly as web_search reads it for \"near me\"", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "home_location", place: "Oakland, CA" });
    const outcome = await buildTripSpec("Colorado", "this upcoming Thanksgiving weekend", "u1");
    if (outcome.kind !== "spec") throw new Error("expected a spec");
    expect(outcome.spec.origin).toBe("Oakland, CA");
    expect(outcome.spec.originStatus).toBe("stated");
  });

  it("carries the existing calendar as an input on the spec, not a separate section (R32)", async () => {
    mocks.events = [{ id: "1", summary: "Team standup", start: "2026-11-27T16:00:00Z", end: "2026-11-27T16:30:00Z", allDay: false, location: null }];
    const outcome = await buildTripSpec("Colorado", "this upcoming Thanksgiving weekend", "u1");
    if (outcome.kind !== "spec") throw new Error("expected a spec");
    expect(outcome.spec.commitments[0]).toContain("Team standup");
  });

  it("asks, and looks nothing up, when the date is ambiguous or the model is unavailable", async () => {
    mocks.reading = { kind: "ask", question: "Which week?", choices: ["This week", "Next week"] };
    expect(await plan("Colorado", "sometime soon")).toBe("Which week? (This week / Next week)");
    mocks.reading = { kind: "unavailable" };
    expect(await plan("Colorado", "next week")).toMatch(/AI model isn't available/);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

describe("the itinerary critic checks shape only, never the model's judgment (R20.6, R32)", () => {
  const spec: TripSpec = { destination: "Colorado", origin: null, originStatus: "missing", start: Temporal.PlainDate.from("2026-11-26"), endExclusive: Temporal.PlainDate.from("2026-11-29"), label: "", dateStatus: "stated", partySize: 1, partyStatus: "assumed", pace: "moderate", paceStatus: "assumed", commitments: [] };

  it("flags a day count that does not match the resolved date range", () => {
    expect(critiqueItinerary(itinerary({ days: itinerary().days.slice(0, 2) }), spec, 2).some((issue) => issue.includes("3 entries"))).toBe(true);
  });
  it("flags a day with no stops", () => {
    const withEmptyDay = itinerary(); withEmptyDay.days[0].stops = [];
    expect(critiqueItinerary(withEmptyDay, spec, 2).some((issue) => issue.includes("no stops"))).toBe(true);
  });
  it("flags a citation that points at no real source", () => {
    const withBadSource = itinerary(); withBadSource.days[0].stops[0].source = 9;
    expect(critiqueItinerary(withBadSource, spec, 2).some((issue) => issue.includes("not one of"))).toBe(true);
  });
  it("passes a well-formed itinerary", () => {
    expect(critiqueItinerary(itinerary(), spec, 2)).toEqual([]);
  });
});

describe("the full pipeline (research -> extract -> compose -> critique -> render), never the single-shot search-and-summarize path", () => {
  it("fans out several real research queries instead of one shallow lookup", async () => {
    await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(mocks.search.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mocks.search.mock.calls.every((call) => call[1]?.depth === "advanced")).toBe(true);
  });

  it("renders a day-by-day itinerary with sources, assumptions and logistics, not a single paragraph", async () => {
    const answer = await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(answer).toContain("### Colorado,");
    expect(answer).toContain("#### Thu, Nov 26");
    expect(answer).toContain("#### Fri, Nov 27");
    expect(answer).toContain("Rocky Mountain hike");
    expect(answer).toContain("*Assumed:");
    expect(answer).toContain("Getting there and around");
    expect(answer).toContain("### Sources");
  });

  it("always states the calendar outcome plainly, in code, whether it's clear or not — never silent (found live, R32)", async () => {
    const clear = await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(clear).toContain("**Calendar:** Your calendar is clear for these dates.");

    mocks.events = [{ id: "1", summary: "Team standup", start: "2026-11-27T16:00:00Z", end: "2026-11-27T16:30:00Z", allDay: false, location: null }];
    const busy = await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(busy).toMatch(/\*\*Calendar:\*\* You have commitments during this window:.*Team standup/);
  });

  it("says so plainly instead of guessing when research turns up nothing", async () => {
    mocks.search.mockResolvedValue({ answer: "", sources: [] });
    expect(await plan("Nowhereville", "next week")).toMatch(/couldn't find reliable current information/);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("repairs once when the composer's own output does not match its spec, and still returns an answer either way", async () => {
    let compositions = 0;
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "trip_candidate_extraction") return modelReply(candidates);
      compositions += 1;
      // First attempt is missing a day; the repaired attempt is correct.
      return modelReply(compositions === 1 ? itinerary({ days: itinerary().days.slice(0, 2) }) : itinerary());
    });
    const answer = await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(compositions).toBe(2);
    expect(mocks.complete.mock.calls[2][1].messages[0].content).toMatch(/Your previous attempt had problems/);
    expect(answer).toContain("#### Sat, Nov 28");
  });

  it("asks for the model a tier actually means today, so a live eval's raw client (which never reselects a model the way callClaude does) still gets the right one", async () => {
    await plan("Colorado", "this upcoming Thanksgiving weekend");
    const extraction = mocks.complete.mock.calls.find((call) => call[0] === "trip_candidate_extraction");
    const composition = mocks.complete.mock.calls.find((call) => call[0] === "trip_itinerary_composition");
    expect(extraction?.[1].model).toBe("claude-haiku-4-5-20251001");
    expect(composition?.[1].model).toBe("claude-haiku-4-5-20251001");
  });

  it("never sends `temperature` when the composer's model is one that rejects it (Sonnet/Opus's own API contract), but still does for Haiku (found live, R32)", async () => {
    mocks.models.high = "claude-opus-5";
    await plan("Colorado", "this upcoming Thanksgiving weekend");
    const extraction = mocks.complete.mock.calls.find((call) => call[0] === "trip_candidate_extraction");
    const composition = mocks.complete.mock.calls.find((call) => call[0] === "trip_itinerary_composition");
    expect(extraction?.[1]).toHaveProperty("temperature", 0); // extraction still runs on Haiku
    expect(composition?.[1]).not.toHaveProperty("temperature");
  });

  it("degrades to \"nothing specific enough\" instead of crashing when extraction's response is malformed or truncated (found live, R21)", async () => {
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "trip_candidate_extraction") return { content: [{ type: "text", text: "{\"candidates\": [ not valid json" }] };
      return modelReply(itinerary());
    });
    const answer = await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(answer).toMatch(/nothing specific enough/);
  });

  it("retries once with a corrective note, then degrades to a plain message, when composition's response is malformed or truncated (found live, R21)", async () => {
    let compositions = 0;
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "trip_candidate_extraction") return modelReply(candidates);
      compositions += 1;
      if (compositions === 1) return { content: [{ type: "text", text: "{\"summary\": \"cut off mid" }] };
      return modelReply(itinerary());
    });
    const answer = await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(compositions).toBe(2);
    expect(mocks.complete.mock.calls[2][1].messages[0].content).toMatch(/could not be read as valid JSON/);
    expect(answer).toContain("#### Thu, Nov 26");

    compositions = 0;
    mocks.complete.mockImplementation(async (operation: string) => {
      if (operation === "trip_candidate_extraction") return modelReply(candidates);
      compositions += 1;
      return { content: [{ type: "text", text: "not json at all" }] };
    });
    expect(await plan("Colorado", "this upcoming Thanksgiving weekend")).toMatch(/ran into a problem putting that itinerary together/);
    expect(compositions).toBe(2); // one repair attempt, then it gives up rather than looping
  });

  it("adds the drive estimate from the saved home location as an input to the composer, not a fabricated detail", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "home_location", place: "Oakland, CA" });
    await plan("Colorado", "this upcoming Thanksgiving weekend");
    expect(mocks.route).toHaveBeenCalledWith("Oakland, CA", "Colorado");
    const compositionCall = mocks.complete.mock.calls.find((call) => call[0] === "trip_itinerary_composition");
    expect(compositionCall?.[1].messages[0].content).toMatch(/Drive estimate:/);
  });
});
