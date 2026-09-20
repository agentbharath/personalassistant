import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { TIME_JSON_SCHEMA, interpretTime, timeCacheMaterial, type TimeInput } from "./time-interpreter";

const input: TimeInput = { message: "what's on saturday at 2pm", today: "2026-09-21", timeZone: "America/Los_Angeles", userId: "u1" };
const base = { kind: "day", start: "2026-09-26T00:00:00", end: "2026-09-27T00:00:00", label: "on Saturday", place: "", question: "", choices: [] as string[], confidence: 0.95 };

function fake(output: object) {
  return { content: [{ type: "text", text: JSON.stringify({ ...base, ...output }) }] } as unknown as Anthropic.Message;
}
const run = (output: object, message = input) => interpretTime(message, { complete: async () => fake(output) });

describe("the time interpreter reads dates with a model and checks only their form (free)", () => {
  it("has no union-typed parameters, so structured outputs accept it", () => {
    expect(JSON.stringify(TIME_JSON_SCHEMA)).not.toMatch(/anyOf|oneOf|"type":\[/);
  });

  it("turns a day into a window in the person's time zone", async () => {
    const reading = await run({});
    if (reading.kind !== "window") throw new Error("expected a window");
    expect(reading.window.start.toString()).toBe("2026-09-26T00:00:00-07:00[America/Los_Angeles]");
    expect(reading.window.end.toString()).toBe("2026-09-27T00:00:00-07:00[America/Los_Angeles]");
    expect(reading.window.label).toBe("on Saturday");
    expect(reading.moment).toBeNull();
  });

  it("a moment lists the whole day and keeps the start time and place", async () => {
    const reading = await run({ kind: "moment", start: "2026-09-26T14:00:00", end: "", place: "AMC Bay Street" });
    if (reading.kind !== "window") throw new Error("expected a window");
    expect(reading.moment?.toString()).toBe("2026-09-26T14:00:00-07:00[America/Los_Angeles]");
    expect(reading.window.start.hour).toBe(0);
    expect(reading.place).toBe("AMC Bay Street");
  });

  it("a message with no time shows today", async () => {
    const reading = await run({ kind: "none", start: "", end: "" });
    if (reading.kind !== "window") throw new Error("expected a window");
    expect(reading.window.start.toPlainDate().toString()).toBe("2026-09-21");
    expect(reading.window.label).toBe("today");
  });

  it("asks, with tappable choices, when the model says the time is ambiguous", async () => {
    const reading = await run({ kind: "ambiguous", question: "Did you mean 7 am or 7 pm?", choices: ["7 am", "7 pm", "7 pm"] });
    expect(reading).toEqual({ kind: "ask", question: "Did you mean 7 am or 7 pm?", choices: ["7 am", "7 pm"] });
  });

  it("asks instead of guessing when the answer is unusable", async () => {
    for (const bad of [
      { start: "not a date" },
      { end: "2026-09-25T00:00:00" }, // ends before it starts
      { start: "2031-09-26T00:00:00", end: "2031-09-27T00:00:00" }, // years away
      { kind: "range", start: "2026-09-26T00:00:00", end: "2027-03-01T00:00:00" }, // months long
    ]) {
      expect((await run(bad)).kind).toBe("ask");
    }
  });

  it("says it is unavailable, and uses no rules, when the model fails or answers with junk", async () => {
    expect(await interpretTime(input, { complete: async () => { throw new Error("down"); } })).toEqual({ kind: "unavailable" });
    expect(await interpretTime(input, { complete: async () => ({ content: [{ type: "text", text: "{}" }] } as unknown as Anthropic.Message) })).toEqual({ kind: "unavailable" });
  });

  it("repeats an identical question from the cache without calling the model again", async () => {
    const store = new Map<string, string>();
    const cache = { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: string) => { store.set(key, value); } };
    const complete = vi.fn(async () => fake({}));
    await interpretTime(input, { complete, cache });
    await interpretTime(input, { complete, cache });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by today's date, so 'tomorrow' is not reused on another day", () => {
    expect(timeCacheMaterial(input)).not.toBe(timeCacheMaterial({ ...input, today: "2026-09-22" }));
  });
});
