import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
const mocks = vi.hoisted(() => ({ interpretTime: vi.fn(), listCalendar: vi.fn(), recall: vi.fn(), model: vi.fn() }));
vi.mock("./time-interpreter-runtime", () => ({ interpretTimeForUser: mocks.interpretTime }));
vi.mock("./calendar", () => ({ listCalendarForWindow: mocks.listCalendar }));
vi.mock("@/lib/conversations/history", () => ({ recallConversation: mocks.recall }));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: mocks.model }));
import { answerRecallAndAvailability } from "./recall-availability";

const TZ = "America/Los_Angeles";
const window = (startISO: string, endISO: string, label: string) => ({
  start: Temporal.ZonedDateTime.from(`${startISO}[${TZ}]`), end: Temporal.ZonedDateTime.from(`${endISO}[${TZ}]`), label,
});
const event = (id: string, summary: string, start: string, end: string) => ({ id, summary, start, end, allDay: false });
const placeRef = (id: string, query: string, names: string[], createdAt = "2026-09-26T00:00:00.000Z") =>
  ({ id, kind: "place_results" as const, createdAt, state: { query, places: names.map((name) => ({ name, address: "", note: "" })), updatedAt: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recall.mockResolvedValue({ text: "no history", references: [] });
});

describe("the calendar half (availability)", () => {
  it("reads a fully free window as one Free segment spanning the whole width", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-10-02T17:00:00", "2026-10-02T23:00:00", "Friday evening"), moment: null, place: null });
    mocks.listCalendar.mockResolvedValue([]);
    const answer = await answerRecallAndAvailability("u1", "c1", "check if Friday evening is free", "find the restaurant", "", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.availability.free).toBe(true);
    expect(card.availability.segments).toEqual([{ kind: "free", label: "Free", widthPercent: 100 }]);
    expect(card.availability.dateLabel).toContain("Friday evening");
    expect(card.headline).toContain("Friday evening is free");
  });

  it("splits into free/busy segments around an event inside the window", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-10-02T17:00:00", "2026-10-02T21:00:00", "Friday evening"), moment: null, place: null });
    // 6-7 PM busy, out of a 5-9 PM (4 hour) window: 25% free, 25% busy, 50% free
    mocks.listCalendar.mockResolvedValue([event("e1", "Dinner with Sam", "2026-10-03T01:00:00Z", "2026-10-03T02:00:00Z")]);
    const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant", "", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.availability.free).toBe(false);
    expect(card.availability.segments).toEqual([
      { kind: "free", label: "Free", widthPercent: 25 },
      { kind: "busy", label: "Dinner with Sam", widthPercent: 25 },
      { kind: "free", label: "Free", widthPercent: 50 },
    ]);
  });

  it("falls back to no availability (not a broken half) when the time can't be resolved", async () => {
    mocks.interpretTime.mockResolvedValue({ kind: "ask", question: "Which Friday?", choices: [] });
    mocks.recall.mockResolvedValue({ text: "x", references: [placeRef("r1", "best sushi restaurants in Sunnyvale, CA", ["Katana Sushi & Sake"])] });
    const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant", "restaurant recommendation", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.availability).toBeNull();
    expect(card.recall).not.toBeNull();
  });
});

describe("the recall half", () => {
  beforeEach(() => mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-10-02T17:00:00", "2026-10-02T23:00:00", "Friday evening"), moment: null, place: null }));

  it("offers the saved search as candidates when the model finds no definite recommendation, never inventing one", async () => {
    mocks.listCalendar.mockResolvedValue([]);
    mocks.recall.mockResolvedValue({ text: "just a search, no recommendation", references: [placeRef("r1", "best sushi restaurants in Sunnyvale, CA", ["Katana Sushi & Sake", "Senro Sunnyvale", "Enka Japanese Izakaya", "Sushi Boat", "KOKO izakaya and oyster house", "Nozomi"]) ] });
    mocks.model.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ resolvedId: null, note: "I don't have a record of recommending one. These came up when you searched sushi on Sep 26. Which was it?" }) }] });
    const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant recommendation", "restaurant recommendation last week", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.recall.resolvedName).toBeNull();
    expect(card.recall.candidates).toHaveLength(5); // capped
    expect(card.recall.candidates[0]).toEqual({ id: "r1-0", name: "Katana Sushi & Sake" });
    expect(card.recall.moreCount).toBe(1); // the 6th place, beyond the cap
    expect(card.recall.note).toContain("sushi on Sep 26");
  });

  it("shows a resolved recommendation, no picker, when conversation text actually named one", async () => {
    mocks.listCalendar.mockResolvedValue([]);
    mocks.recall.mockResolvedValue({ text: "you said Katana Sushi looked great", references: [placeRef("r1", "best sushi restaurants in Sunnyvale, CA", ["Katana Sushi & Sake", "Senro Sunnyvale"])] });
    mocks.model.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ resolvedId: "r1-0", note: "You said Katana Sushi & Sake looked great, last Tuesday." }) }] });
    const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant", "restaurant recommendation", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.recall.resolvedName).toBe("Katana Sushi & Sake");
    expect(card.recall.candidates).toEqual([]);
  });

  it("returns candidates (never a resolvedId outside the given list) even if the judgment call fails", async () => {
    mocks.listCalendar.mockResolvedValue([]);
    mocks.recall.mockResolvedValue({ text: "x", references: [placeRef("r1", "best sushi restaurants in Sunnyvale, CA", ["Katana Sushi & Sake"])] });
    mocks.model.mockRejectedValue(new Error("model unavailable"));
    const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant", "restaurant recommendation", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.recall.resolvedName).toBeNull();
    expect(card.recall.candidates).toEqual([{ id: "r1-0", name: "Katana Sushi & Sake" }]);
  });

  it("returns null recall (falls back to the plain half) when no saved search reference exists at all", async () => {
    mocks.listCalendar.mockResolvedValue([]);
    mocks.recall.mockResolvedValue({ text: "nothing relevant", references: [] });
    const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant", "restaurant recommendation", []);
    const card = JSON.parse(answer!.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.recall).toBeNull();
    expect(card.availability).not.toBeNull();
    expect(mocks.model).not.toHaveBeenCalled();
  });
});

it("returns null (the caller falls back to plain composition) when neither half resolved", async () => {
  mocks.interpretTime.mockResolvedValue({ kind: "unavailable" });
  mocks.recall.mockResolvedValue({ text: "nothing", references: [] });
  const answer = await answerRecallAndAvailability("u1", "c1", "check Friday evening", "find the restaurant", "restaurant recommendation", []);
  expect(answer).toBeNull();
});
