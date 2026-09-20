import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ found: [] as Array<{ id: string; threadId: string; subject: string; from: string; date: string; receivedAt: number; snippet: string }>, body: "" }));
vi.mock("@/lib/tools/email/google-gmail", () => ({
  searchGmail: async () => mocks.found,
  readGmailMessage: async (_user: string, id: string) => ({ ...mocks.found.find((message) => message.id === id)!, text: mocks.body, attachments: [] }),
}));

import { MATTER_WORDS, answerStatusLookup, parseStatusLookup } from "./status-lookup";

describe("status questions (evals/status-lookup.jsonl)", () => {
  const rows = readFileSync(resolve(process.cwd(), "evals/status-lookup.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { id: string; rule: string; input: string; expect: unknown });
  for (const { id, rule, input, expect: want } of rows) {
    it(`${id} [${rule}]`, () => {
      const got = parseStatusLookup(input);
      if (want === null) return expect(got).toBeNull();
      expect({ sender: got?.sender.toLowerCase(), matter: got?.matter }).toEqual({ sender: (want as { sender: string }).sender.toLowerCase(), matter: (want as { matter: string }).matter });
    });
  }
});

const message = (id: string, subject: string, month: number) => ({ id, threadId: `t-${id}`, subject, from: "Chase <no.reply@chase.com>", date: `2026-0${month}-10T10:00:00Z`, receivedAt: Date.UTC(2026, month - 1, 10), snippet: "" });

describe("what the user gets (R18.2, R18.3, R18.4)", () => {
  beforeEach(() => { mocks.found = []; mocks.body = "We are reviewing your dispute and will send a decision within 45 days. No action is needed from you right now."; });

  it("shows the newest email with its text, earlier ones by date, and says it is not live status", async () => {
    mocks.found = [message("old", "We received your dispute", 7), message("new", "Update on your dispute", 9), message("mid", "More information needed", 8)];
    const answer = await answerStatusLookup("u1", { sender: "chase", matter: "dispute" });
    expect(answer).toContain("### chase — dispute");
    expect(answer).toContain("Latest email, Sep 10, 2026");
    expect(answer).toContain("Update on your dispute");
    expect(answer).toContain("We are reviewing your dispute");
    expect(answer.indexOf("More information needed")).toBeLessThan(answer.indexOf("We received your dispute"));
    expect(answer).toContain("For the live status, check with chase directly.");
    expect(answer).toContain("Searched: email from chase mentioning “dispute” or “claim”, “chargeback”, “provisional credit”");
  });

  it("treats a company's own word for the matter as the same matter (Chase calls a dispute a claim)", () => {
    expect(MATTER_WORDS.dispute).toEqual(expect.arrayContaining(["claim", "chargeback"]));
    expect(MATTER_WORDS.claim).toContain("dispute");
  });

  it("leaves out marketing that only mentions the word in its body", async () => {
    mocks.found = [message("a", "Your claim needs attention", 9), message("b", "We received your claim", 9), message("promo", "Bharath, get up to $1,000 cash bonus when you invest", 8)];
    const answer = await answerStatusLookup("u1", { sender: "chase", matter: "dispute" });
    expect(answer).toContain("We received your claim");
    expect(answer).not.toContain("cash bonus");
  });

  it("falls back to whatever matched when no subject is about the matter", async () => {
    mocks.found = [message("c", "Important account notice", 9)];
    expect(await answerStatusLookup("u1", { sender: "chase", matter: "dispute" })).toContain("Important account notice");
  });

  it("says plainly when nothing matches, and asks what to try", async () => {
    const answer = await answerStatusLookup("u1", { sender: "chase", matter: "dispute" });
    expect(answer).toMatch(/don't see any email from chase mentioning a dispute \(or claim, chargeback, provisional credit\) in the last year/);
    expect(answer).toMatch(/phone or letter/);
  });

  it("ignores mail from an unrelated sender", async () => {
    mocks.found = [{ ...message("x", "Your dispute with Chase", 9), from: "Some Blog <news@blog.com>" }];
    expect(await answerStatusLookup("u1", { sender: "chase", matter: "dispute" })).toMatch(/don't see any email/);
  });
});
