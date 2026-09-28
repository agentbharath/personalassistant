import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ model: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: mocks.model }));
vi.mock("@/lib/tools/email/google-gmail", () => ({ searchGmail: mocks.search }));
import { GoogleGmailAccessError } from "@/lib/tools/email/gmail-transport";
import { answerEmailImportant } from "./email-triage";

const message = (id: string, from: string, subject: string, over: Partial<{ receivedAt: number; snippet: string }> = {}) =>
  ({ id, threadId: id, subject, from, date: "", receivedAt: Date.now(), snippet: "…", ...over });

beforeEach(() => vi.clearAllMocks());

describe("what needs the person's attention (email_important)", () => {
  it("embeds a card with the action items highlighted and the rest summarized", async () => {
    mocks.search.mockResolvedValue([
      message("1", "Recruiting Team <rc@company.com>", "Scheduling your onsite"),
      message("2", "DocuSign <no-reply@docusign.net>", "Lease renewal ready to sign"),
      message("3", "Newsletter <news@example.com>", "This week in tech"),
    ]);
    mocks.model.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({
      items: [{ id: "1", needsAction: true, hint: "Reply by Wed" }, { id: "2", needsAction: true, hint: "Signature needed" }, { id: "3", needsAction: false, hint: null }],
      insight: "One reply by Wednesday, one signature. Everything else can wait.",
      othersSummary: "a newsletter",
    }) }] });

    const answer = await answerEmailImportant("u1");
    expect(mocks.search.mock.calls[0][1]).toContain("newer_than:1d");
    expect(answer).toContain("### Since yesterday · 3 new");
    expect(answer).toContain("2 need you");
    expect(answer).toContain("Reply by Wed");
    expect(answer).toContain("```daylark-card");

    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.kind).toBe("email");
    expect(card.totalCount).toBe(3);
    expect(card.needCount).toBe(2);
    expect(card.othersCount).toBe(1);
    expect(card.othersSummary).toBe("a newsletter");
    expect(card.highlights).toEqual([
      { id: "1", sender: "Recruiting Team", initials: "RT", subject: "Scheduling your onsite", time: expect.any(String), hint: "Reply by Wed" },
      { id: "2", sender: "DocuSign", initials: "D", subject: "Lease renewal ready to sign", time: expect.any(String), hint: "Signature needed" },
    ]);
  });

  it("says plainly there's nothing new, without calling the model, when the inbox has no new mail", async () => {
    mocks.search.mockResolvedValue([]);
    const answer = await answerEmailImportant("u1");
    expect(answer).toBe("Since yesterday · nothing new in your inbox.");
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("falls back to a plain time-ordered list, no card, when the judgment call fails", async () => {
    mocks.search.mockResolvedValue([message("1", "Someone <a@b.com>", "Hello")]);
    mocks.model.mockRejectedValue(new Error("model unavailable"));
    const answer = await answerEmailImportant("u1");
    expect(answer).toContain("couldn't judge which of these need your attention");
    expect(answer).toContain("Someone");
    expect(answer).toContain("Hello");
    expect(answer).not.toContain("daylark-card");
  });

  it("surfaces a friendly message, and never throws, when Gmail access itself fails", async () => {
    mocks.search.mockRejectedValue(new GoogleGmailAccessError("insufficient_scope"));
    const answer = await answerEmailImportant("u1");
    expect(answer).toContain("couldn't check your email");
    expect(answer).toContain("reconnect Google");
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
