import { describe, expect, it } from "vitest";
import { buildDayCard } from "./day-card";
import type { DailyView } from "./load";

const event = (id: string, start: string, end: string, over: Partial<{ allDay: boolean; location: string }> = {}) =>
  ({ id, summary: id, start, end, allDay: false, ...over });

const baseView = (meetingsToday: DailyView["meetingsToday"]): DailyView => ({
  today: "2026-09-28",
  meetingsToday,
  meetingsAhead: { state: "ok", value: [] },
  bills: { state: "ok", value: { overdue: [], dueToday: [], dueThisWeek: [], dueLater: [], noDueDate: [] } },
  spending: { state: "ok", value: null },
});

describe("the day card's timeline (free)", () => {
  it("is null when meetings couldn't load -- the markdown alone explains why", () => {
    expect(buildDayCard(baseView({ state: "needs_connection" }))).toBeNull();
    expect(buildDayCard(baseView({ state: "unavailable" }))).toBeNull();
  });

  it("inserts a Free row for a gap of an hour or more between two meetings, but not a shorter one", () => {
    const view = baseView({ state: "ok", value: [
      event("Standup", "2026-09-28T16:30:00Z", "2026-09-28T16:45:00Z"), // 9:30-9:45 PT
      event("Design review", "2026-09-28T18:00:00Z", "2026-09-28T19:00:00Z"), // 11:00-12:00 PT (75 min gap)
      event("1:1", "2026-09-28T20:00:00Z", "2026-09-28T20:30:00Z"), // 1:00-1:30 PT (60 min gap -- exactly the threshold)
      event("Sprint planning", "2026-09-28T20:45:00Z", "2026-09-28T21:45:00Z"), // 1:45-2:45 PT (15 min gap -- too short)
    ] });
    const card = buildDayCard(view, "2026-09-28T15:00:00Z");
    expect(card!.count).toBe(4);
    const kinds = card!.timeline.map((row) => `${row.kind}:${row.label}`);
    expect(kinds).toEqual(["meeting:Standup", "free:Free", "meeting:Design review", "free:Free", "meeting:1:1", "meeting:Sprint planning"]);
    expect(card!.timeline.find((row) => row.label === "Design review")?.duration).toBe("1 hr");
  });

  it("flags the next meeting starting within the hour, and marks a finished one as past", () => {
    const view = baseView({ state: "ok", value: [
      event("Standup", "2026-09-28T16:30:00Z", "2026-09-28T16:45:00Z"),
      event("Design review", "2026-09-28T18:00:00Z", "2026-09-28T19:00:00Z"),
    ] });
    const card = buildDayCard(view, "2026-09-28T17:40:00Z"); // 20 min before Design review, well after Standup ended
    expect(card!.timeline.find((row) => row.label === "Standup")?.past).toBe(true);
    expect(card!.timeline.find((row) => row.label === "Design review")?.startingIn).toBe("in 20 min");
  });

  it("keeps all-day events out of the timed gap math, listed as their own row with no time", () => {
    const view = baseView({ state: "ok", value: [event("Company holiday", "2026-09-28", "2026-09-29", { allDay: true })] });
    const card = buildDayCard(view, "2026-09-28T15:00:00Z");
    expect(card!.timeline).toEqual([{ time: "", label: "Company holiday", duration: null, kind: "allday", startingIn: null, past: false, location: null }]);
  });

  it("reads a fully free day plainly, without inventing a busy/free split", () => {
    const card = buildDayCard(baseView({ state: "ok", value: [] }), "2026-09-28T15:00:00Z");
    expect(card!.count).toBe(0);
    expect(card!.insight).toBe("Nothing on your calendar today.");
  });

  it("names the longest gap as the day's focus block when morning and afternoon are both busy", () => {
    const view = baseView({ state: "ok", value: [
      event("Morning sync", "2026-09-28T16:00:00Z", "2026-09-28T16:30:00Z"), // 9:00-9:30 PT
      event("Afternoon review", "2026-09-28T21:00:00Z", "2026-09-28T21:30:00Z"), // 2:00-2:30 PT
    ] });
    const card = buildDayCard(view, "2026-09-28T15:00:00Z");
    expect(card!.insight).toBe("Busy most of the day. Your longest focus block is 9:30 to 2:00.");
  });
});
