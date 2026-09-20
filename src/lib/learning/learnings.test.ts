import { describe, expect, it } from "vitest";
import { mentionsAll, parseEmailRequest } from "@/lib/agents/email-request";
import { DEFAULT_WINDOW_DAYS, NO_LEARNINGS, applyLearnings, describeSearch } from "./learnings";

describe("default window (R11.1)", () => {
  it("defaults a windowless search to 30 days and marks it", () => {
    const { request, defaultedWindow } = applyLearnings(parseEmailRequest("all iherb receipts"), NO_LEARNINGS);
    expect(request.days).toBe(DEFAULT_WINDOW_DAYS);
    expect(defaultedWindow).toBe(true);
  });
  it("never overrides an explicit window", () => {
    const explicit = applyLearnings(parseEmailRequest("iherb receipts last 90 days"), NO_LEARNINGS);
    expect(explicit.request.days).toBe(90);
    expect(explicit.defaultedWindow).toBe(false);
    expect(applyLearnings(parseEmailRequest("emails from Google today"), NO_LEARNINGS).defaultedWindow).toBe(false);
  });
  it("does not window a single 'latest receipt' import", () => {
    expect(applyLearnings(parseEmailRequest("import my latest iherb receipt"), NO_LEARNINGS).request.days).toBeNull();
  });
});

describe("learned values (R11.4, R11.5)", () => {
  it("uses a learned default, per topic first", () => {
    const learnings = { ...NO_LEARNINGS, defaultDays: { all: 60, receipt: 90 } };
    expect(applyLearnings(parseEmailRequest("iherb receipts"), learnings).request.days).toBe(90);
    expect(applyLearnings(parseEmailRequest("recruiter emails"), learnings).request.days).toBe(60);
  });
  it("applies a sender alias", () => {
    const result = applyLearnings(parseEmailRequest("emails from adobee"), { ...NO_LEARNINGS, senderAliases: { adobee: "Adobe" } });
    expect(result.request.sender).toBe("Adobe");
    expect(result.aliasedFrom).toBe("adobee");
  });
});

describe("search terms (R11.2)", () => {
  it("describes the search in plain words", () => {
    const { request, defaultedWindow } = applyLearnings(parseEmailRequest("Show receipts from iherb, but skip anything promotional."), NO_LEARNINGS);
    expect(describeSearch(request, defaultedWindow)).toBe("receipts · from iherb · last 30 days (default) · excluding: anything promotional");
  });
  it("does not mark an explicit window as default", () => {
    const { request, defaultedWindow } = applyLearnings(parseEmailRequest("unread recruiter emails today"), NO_LEARNINGS);
    expect(describeSearch(request, defaultedWindow)).toBe("recruiter emails · today · unread only");
  });
});


describe("all means everything (R11.7)", () => {
  it("detects all/every/each outside an exclusion clause", () => {
    expect(mentionsAll("show all iherb receipts")).toBe(true);
    expect(mentionsAll("every invoice from Adobe")).toBe(true);
    expect(mentionsAll("show iherb receipts, but skip all promotions")).toBe(false);
    expect(mentionsAll("show iherb receipts")).toBe(false);
  });
  it("uses the longest window, explicitly, instead of the default", () => {
    const result = applyLearnings(parseEmailRequest("show all iherb receipts"), NO_LEARNINGS, { everything: true });
    expect(result.request.days).toBe(365);
    expect(result.defaultedWindow).toBe(false);
    expect(describeSearch(result.request, result.defaultedWindow)).toBe("receipts · from iherb · last 365 days");
  });
  it("still honors an explicit window over 'all'", () => {
    expect(applyLearnings(parseEmailRequest("show all iherb receipts last 60 days"), NO_LEARNINGS, { everything: true }).request.days).toBe(60);
  });
});
