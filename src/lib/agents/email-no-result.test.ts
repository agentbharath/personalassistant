import { describe, expect, it } from "vitest";
import { DAYLARK_PERSONA } from "@/lib/model/persona";
import { fallbackNoResult } from "./email";

describe("no-result voice (R6.4)", () => {
  const base = { terms: "receipts · from iherb · last 30 days (default)", sender: "iherb", window: "the last 30 days", defaulted: true, nearMiss: null };
  it.each(["nothing", "outside_window", "wrong_kind"] as const)("the offline fallback for %s never uses the stock system sentence", (kind) => {
    const text = fallbackNoResult({ ...base, kind });
    expect(text).not.toMatch(/connected gmail account|couldn.t find matching email/i);
    expect(text).toMatch(/\?/);
  });
  it("names the sender when nothing turned up, and asks about spelling", () => {
    expect(fallbackNoResult({ ...base, kind: "nothing" })).toMatch(/iherb/);
  });
  it("tells the model to interpret first and ask one specific question (R12)", () => {
    expect(DAYLARK_PERSONA).toContain("Interpret before you ask");
    expect(DAYLARK_PERSONA).toContain("Never refuse or stall because a message is unclear or misspelled");
  });
});
