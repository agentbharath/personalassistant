import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { TimeReading } from "@/lib/agents/time-interpreter";
import { checkTime, loadTimeCases } from "./time-check";

const zone = "America/Los_Angeles";
const at = (value: string) => Temporal.PlainDateTime.from(value).toZonedDateTime(zone);
const window = (start: string, end: string, moment: string | null = null, place: string | null = null): TimeReading => ({ kind: "window", window: { start: at(start), end: at(end), label: "" }, moment: moment ? at(moment) : null, place });

describe("the time-case grader and case file (free)", () => {
  it("loads well-formed cases with unique ids", () => {
    const cases = loadTimeCases();
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    for (const item of cases) expect(Temporal.PlainDate.from(item.today).toString()).toBe(item.today);
  });

  it("accepts a matching window and reports each way it differs", () => {
    const expected = { kind: "window" as const, start: "2026-09-26T00:00:00", end: "2026-09-27T00:00:00", moment: "2026-09-26T14:00:00", place: "AMC" };
    expect(checkTime(window("2026-09-26T00:00:00", "2026-09-27T00:00:00", "2026-09-26T14:00:00", "AMC Bay Street"), expected)).toEqual([]);
    expect(checkTime(window("2026-09-27T00:00:00", "2026-09-28T00:00:00"), expected).length).toBe(4);
  });

  it("checks asking and unavailable", () => {
    expect(checkTime({ kind: "ask", question: "?", choices: ["a", "b"] }, { kind: "ask", choices: true })).toEqual([]);
    expect(checkTime({ kind: "ask", question: "?", choices: [] }, { kind: "ask", choices: true })).toHaveLength(1);
    expect(checkTime(window("2026-09-26T00:00:00", "2026-09-27T00:00:00"), { kind: "ask" })).toHaveLength(1);
    expect(checkTime({ kind: "unavailable" }, { kind: "window" })).toHaveLength(1);
  });
});
