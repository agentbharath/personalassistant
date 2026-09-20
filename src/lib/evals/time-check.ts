import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TimeReading } from "@/lib/agents/time-interpreter";

export type TimeCase = {
  id: string;
  input: string;
  today: string;
  context?: { role: "user" | "assistant"; content: string }[];
  /** kind "window" checks the local start/end (and moment/place when given); kind "ask" checks that a question came back (and choices when true). */
  expect: { kind: "window" | "ask"; start?: string; end?: string; moment?: string; place?: string; choices?: boolean };
};

export function loadTimeCases(): TimeCase[] {
  return readFileSync(resolve(process.cwd(), "evals", "time.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as TimeCase);
}

const local = (value: { toPlainDateTime(): { toString(options?: { smallestUnit: "second" }): string } }) => value.toPlainDateTime().toString({ smallestUnit: "second" });

/** Problems with a reading, empty when it is what the case expects. Place is compared loosely: it must contain the expected words, or be empty when "" is expected. */
export function checkTime(reading: TimeReading, expected: TimeCase["expect"]): string[] {
  if (reading.kind === "unavailable") return ["the model call failed"];
  if (expected.kind === "ask") {
    if (reading.kind !== "ask") return ["should have asked, but answered with a window"];
    return expected.choices && reading.choices.length < 2 ? ["should have offered choices"] : [];
  }
  if (reading.kind !== "window") return [`should have answered, but asked: ${reading.question}`];
  const problems: string[] = [];
  if (expected.start && local(reading.window.start) !== expected.start) problems.push(`start ${local(reading.window.start)} ≠ ${expected.start}`);
  if (expected.end && local(reading.window.end) !== expected.end) problems.push(`end ${local(reading.window.end)} ≠ ${expected.end}`);
  if (expected.moment && (!reading.moment || local(reading.moment) !== expected.moment)) problems.push(`moment ${reading.moment ? local(reading.moment) : "none"} ≠ ${expected.moment}`);
  if (expected.place === "" && reading.place) problems.push(`place should be empty, got ${reading.place}`);
  if (expected.place && !reading.place?.toLowerCase().includes(expected.place.toLowerCase())) problems.push(`place ${reading.place ?? "none"} ≠ ${expected.place}`);
  return problems;
}
