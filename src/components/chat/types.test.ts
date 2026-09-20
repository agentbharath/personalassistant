import { describe, expect, it } from "vitest";
import { followUps, progressLabel, type Message } from "./types";

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
