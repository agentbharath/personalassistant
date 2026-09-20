import { describe, expect, it } from "vitest";
import { answerChoices, followUps, progressLabel, type Message } from "./types";

const answer = (over: Partial<Message>): Message => ({ role: "assistant", content: "ok", status: "completed", agents: ["email"], ...over });

describe("progress and follow-ups", () => {
  it("names what is running from the agents the server reports", () => {
    expect(progressLabel([])).toBe("Understanding your request…");
    expect(progressLabel(["email"])).toBe("Checking your email…");
    expect(progressLabel(["general", "calendar"])).toBe("Searching the web… Checking your calendar…");
    expect(progressLabel(["unknown"])).toBe("Understanding your request…");
  });

  it("suggests next steps only after a completed answer from a known agent", () => {
    expect(followUps(answer({}))).toContain("Show the amounts");
    expect(followUps(answer({ agents: ["finance"] }))).toContain("Break it down by category");
    expect(followUps(answer({ status: "waiting_for_user" }))).toEqual([]);
    expect(followUps(answer({ notice: true }))).toEqual([]);
    expect(followUps(answer({ agents: [] }))).toEqual([]);
    expect(followUps({ role: "user", content: "hi" })).toEqual([]);
    expect(followUps(undefined)).toEqual([]);
  });
});

describe("tap-to-answer choices", () => {
  const question = (over: Partial<Message>): Message => ({ role: "assistant", content: "Which one?", status: "waiting_for_user", choices: ["1", "2", "3"], ...over });

  it("offers the choices under a live question", () => {
    expect(answerChoices(question({}))).toEqual(["1", "2", "3"]);
  });
  it("offers nothing once the question is answered, or for a notice, or with no choices", () => {
    expect(answerChoices(question({ status: "completed" }))).toEqual([]);
    expect(answerChoices(question({ notice: true }))).toEqual([]);
    expect(answerChoices(question({ choices: undefined }))).toEqual([]);
    expect(answerChoices({ role: "user", content: "hi" })).toEqual([]);
    expect(answerChoices(undefined)).toEqual([]);
  });
  it("drops blanks and caps the list at eight", () => {
    expect(answerChoices(question({ choices: ["", "a", " ", "b"] }))).toEqual(["a", "b"]);
    expect(answerChoices(question({ choices: Array.from({ length: 12 }, (_, index) => String(index)) }))).toHaveLength(8);
  });
});
