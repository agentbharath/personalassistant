import { describe, expect, it } from "vitest";
import { checkDraft, loadDraftCases, type DraftCase } from "./draft-check";

const item = (check: DraftCase["check"], input: DraftCase["input"] = { kind: "new", instruction: "x", ownerName: null, recipient: "y" }): DraftCase => ({ id: "t", input, check });

describe("grading a written draft (free; a wrong grader would waste credits)", () => {
  it("loads well-formed cases with unique ids", () => {
    const cases = loadDraftCases();
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("passes a draft that meets every check, and reports each one that fails", () => {
    const draft = { subject: "Re: Lease", body: "Hi Sarah, I will send the lease Thursday." };
    expect(checkDraft(draft, item({ includes: ["Thursday"], excludes: ["["], maxWords: 20, subjectStartsWith: "Re:" }))).toEqual([]);
    expect(checkDraft(draft, item({ includes: ["Friday"] }))[0]).toMatch(/should include “Friday”/);
    expect(checkDraft(draft, item({ excludes: ["lease"] }))[0]).toMatch(/should not include/);
    expect(checkDraft(draft, item({ maxWords: 3 }))[0]).toMatch(/more than 3/);
    expect(checkDraft(draft, item({ subjectNotContains: "Re:" }))[0]).toMatch(/should not contain/);
  });

  it("checks that an edit is shorter and keeps the subject", () => {
    const current = { subject: "Lease", body: "one two three four five six" };
    const edit = item({ shorterThanCurrent: true, keepSubject: true }, { kind: "edit", instruction: "shorter", ownerName: null, current });
    expect(checkDraft({ subject: "Lease", body: "one two" }, edit)).toEqual([]);
    expect(checkDraft({ subject: "Other", body: "one two three four five six seven" }, edit)).toHaveLength(2);
  });

  it("fails when there is no draft", () => {
    expect(checkDraft(null, item({}))[0]).toMatch(/no usable draft/);
  });
});
