import { describe, expect, it } from "vitest";
import { acknowledgeLearning, describeLearning, matchesForget, renderLearnings } from "./commands";
import { NO_LEARNINGS, applyLearnedAction, learnFromReinterpretation, withLearning, type Learning } from "./learnings";
import { parseEmailRequest } from "@/lib/agents/email-request";
import { applyMerchantLearnings, normalizeCategory } from "./preferences";

const all: Learning[] = [
  { kind: "default_window", topic: "receipt", days: 90 },
  { kind: "sender_alias", alias: "adobee", canonical: "Adobe" },
  { kind: "default_action", topic: "receipt", action: "amounts" },
  { kind: "calendar_duration", minutes: 30 },
  { kind: "calendar_buffer", minutes: 20 },
  { kind: "merchant_category", merchant: "iHerb", category: "health" },
  { kind: "merchant_alias", alias: "amzn", canonical: "Amazon" },
];
const learned = all.reduce(withLearning, NO_LEARNINGS);

describe("folding learnings (R14, R11)", () => {
  it("folds every kind into the in-memory set", () => {
    expect(learned).toEqual({
      defaultDays: { receipt: 90 },
      senderAliases: { adobee: "Adobe" },
      defaultActions: { receipt: "amounts" },
      calendar: { durationMinutes: 30, bufferMinutes: 20 },
      merchantCategories: { iherb: "health" },
      merchantAliases: { amzn: "Amazon" },
      autopay: [],
    });
  });
  it("a newer value replaces the older one", () => {
    expect(withLearning(learned, { kind: "calendar_buffer", minutes: 10 }).calendar.bufferMinutes).toBe(10);
  });
});

describe("applying merchant learnings (R14.2)", () => {
  const base = { occurredOn: "2026-09-15", amountMinor: 3553, merchant: "iHerb", category: "shopping" };
  it("recategorizes a learned merchant, case-insensitively", () => {
    expect(applyMerchantLearnings(base, learned)).toMatchObject({ candidate: { category: "health" }, recategorized: true, renamed: false });
    expect(applyMerchantLearnings({ ...base, merchant: "IHERB" }, learned).candidate.category).toBe("health");
  });
  it("renames an alias and then applies the category of the real name", () => {
    const withAlias = withLearning(learned, { kind: "merchant_category", merchant: "Amazon", category: "shopping" });
    expect(applyMerchantLearnings({ ...base, merchant: "AMZN", category: "other" }, withAlias)).toMatchObject({ candidate: { merchant: "Amazon", category: "shopping" }, renamed: true });
  });
  it("leaves everything else alone", () => {
    expect(applyMerchantLearnings({ ...base, merchant: "Curry Point", category: "restaurants" }, learned)).toMatchObject({ candidate: { merchant: "Curry Point", category: "restaurants" }, renamed: false, recategorized: false });
  });
});

describe("categories (R14.4)", () => {
  it.each([["restaurant", "restaurants"], ["a grocery", "groceries"], ["supplements", "health"], ["fuel", "transport"]])("%s → %s", (word, category) => expect(normalizeCategory(word)).toBe(category));
  it("rejects words outside the fixed set", () => expect(normalizeCategory("vitamins")).toBeNull());
});

describe("viewing what was learned (R15.1, R15.4)", () => {
  it("groups by area in plain words", () => {
    const text = renderLearnings(all);
    expect(text).toContain("**Email**");
    expect(text).toContain("**Calendar**");
    expect(text).toContain("**Finance**");
    expect(text).toContain("iHerb goes under health");
    expect(text).toContain("20-minute buffer");
    expect(text).toContain("forget everything");
  });
  it("says so and shows how to teach when empty", () => {
    expect(renderLearnings([])).toMatch(/haven't learned anything/);
    expect(renderLearnings([])).toMatch(/I meant Adobe/);
  });
});

describe("forgetting (R15.2)", () => {
  const forgotten = (term: string) => all.filter((learning) => matchesForget(learning, term)).map((learning) => learning.kind);
  it.each([
    ["adobee", ["sender_alias"]],
    ["Adobe", ["sender_alias"]],
    ["default window", ["default_window"]],
    ["receipt amounts", ["default_action"]],
    ["calendar buffer", ["calendar_buffer"]],
    ["default event length", ["calendar_duration"]],
    ["iherb", ["merchant_category"]],
    ["amzn", ["merchant_alias"]],
    ["amazon", ["merchant_alias"]],
    ["nothing like this", []],
  ])("forget %s", (term, kinds) => expect(forgotten(term)).toEqual(kinds));
});

describe("acknowledgements (R14.3)", () => {
  it("every kind has a one-line confirmation that says whether it is retroactive", () => {
    for (const learning of all) expect(acknowledgeLearning(learning)).not.toMatch(/\n/);
    expect(acknowledgeLearning({ kind: "merchant_category", merchant: "iHerb", category: "health" })).toMatch(/existing ones stay/);
    expect(describeLearning(all[0])).toBe("Search receipts back 90 days by default");
  });
});

describe("learning what a request means (R11.8)", () => {
  const list = parseEmailRequest("show all iherb receipts");
  const amounts = parseEmailRequest("show the amounts on my iherb receipts");
  const learned = withLearning(NO_LEARNINGS, { kind: "default_action", topic: "receipt", action: "amounts" });

  it("learns from an explicit correction that lands on amounts, whatever the previous answer was", () => {
    expect(learnFromReinterpretation(list, amounts, true)).toEqual({ kind: "default_action", topic: "receipt", action: "amounts" });
    expect(learnFromReinterpretation(amounts, amounts, true)).toEqual({ kind: "default_action", topic: "receipt", action: "amounts" });
    expect(learnFromReinterpretation(null, amounts, true)).toEqual({ kind: "default_action", topic: "receipt", action: "amounts" });
  });
  it("never learns from an ordinary question, another topic, a non-amounts result, or something already learned", () => {
    expect(learnFromReinterpretation(list, amounts, false)).toBeNull();
    expect(learnFromReinterpretation(list, list, true)).toBeNull();
    expect(learnFromReinterpretation(parseEmailRequest("promotional emails"), { ...amounts, topic: "promotion" }, true)).toBeNull();
    expect(learnFromReinterpretation(list, amounts, true, learned)).toBeNull();
  });
  it("turns a plain receipt list into amounts once learned", () => {
    expect(applyLearnedAction(list, false, learned)).toMatchObject({ applied: true, request: { action: "amounts", sender: "iherb" } });
  });
  it("keeps the plain list when the model read that the person asked for the emails themselves", () => {
    expect(applyLearnedAction(list, true, learned).applied).toBe(false);
  });
  it("does nothing before anything is learned, or for other topics and actions", () => {
    expect(applyLearnedAction(list, false, NO_LEARNINGS).applied).toBe(false);
    expect(applyLearnedAction(parseEmailRequest("promotional emails"), false, learned).applied).toBe(false);
    expect(applyLearnedAction(parseEmailRequest("import all iherb receipts"), false, learned).applied).toBe(false);
  });
});
