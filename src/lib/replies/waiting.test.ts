import { beforeEach, describe, expect, it, vi } from "vitest";

const errors = vi.hoisted(() => ({ ConnectionRequired: class extends Error {} }));
const { ConnectionRequired } = errors;
vi.mock("@/lib/auth/google-credential-broker", () => ({ GoogleConnectionRequiredError: errors.ConnectionRequired }));
vi.mock("@/lib/tools/email/google-gmail", () => ({ GoogleGmailAccessError: class extends Error { reason = "unavailable"; }, readGmailMessage: vi.fn(), searchGmail: vi.fn() }));
vi.mock("@/lib/agents/reply-needed-runtime", () => ({ judgeReplyForUser: vi.fn() }));
vi.mock("./dismissals", () => ({ listDismissedThreads: vi.fn(), threadKey: (id: string) => `k:${id}` }));

import { displayName, inboundQuery, loadWaitingReplies, sentQuery } from "./waiting";

const mail = (id: string, threadId: string, receivedAt: number) => ({ id, threadId, from: "Sam <sam@x.com>", subject: `S-${id}`, receivedAt, snippet: "" });
const search = vi.fn();
const read = vi.fn();
const judge = vi.fn();
const dismissed = vi.fn();
const prefs = vi.fn();
const deps = { search, read, judge, dismissed, prefs } as never;

beforeEach(() => {
  search.mockReset().mockImplementation(async (_user: string, query: string) => (query === inboundQuery ? [mail("a", "t1", 100), mail("b", "t2", 300), mail("c", "t3", 200)] : []));
  read.mockReset().mockResolvedValue({ text: "body" });
  judge.mockReset().mockImplementation(async (input: { messageId: string }) => ({ needsReply: input.messageId !== "c", kind: "person", reason: `why ${input.messageId}` }));
  dismissed.mockReset().mockResolvedValue(new Set<string>());
  prefs.mockReset().mockResolvedValue({ saved: true, perchEnabled: true, remindersEnabled: true, kinds: ["person", "business"] });
});

describe("Waiting on your reply (free, fake Gmail and model)", () => {
  it("looks only at Primary and Updates in the inbox, from the last 14 days, and asks for the owner's sent mail separately", () => {
    expect(inboundQuery).toBe("in:inbox (category:primary OR category:updates) newer_than:14d -from:me");
    expect(sentQuery).toBe("in:sent newer_than:14d");
  });

  it("lists only what the model says needs a reply, waiting longest first", async () => {
    const result = await loadWaitingReplies("u1", deps);
    expect(result).toMatchObject({ state: "ok", pending: 0 });
    if (result.state !== "ok") throw new Error("expected ok");
    expect(result.items.map((item) => item.messageId)).toEqual(["a", "b"]);
    expect(result.items[0].reason).toBe("why a");
  });

  it("leaves out threads the owner already answered", async () => {
    search.mockImplementation(async (_user: string, query: string) => (query === inboundQuery ? [mail("a", "t1", 100), mail("b", "t2", 300)] : [{ id: "s", threadId: "t1", receivedAt: 400 }]));
    const result = await loadWaitingReplies("u1", deps);
    if (result.state !== "ok") throw new Error("expected ok");
    expect(result.items.map((item) => item.messageId)).toEqual(["b"]);
  });

  it("never brings back a dismissed thread", async () => {
    dismissed.mockResolvedValue(new Set(["k:t1"]));
    const result = await loadWaitingReplies("u1", deps);
    if (result.state !== "ok") throw new Error("expected ok");
    expect(result.items.map((item) => item.messageId)).toEqual(["b"]);
    expect(judge.mock.calls.map((call) => call[0].messageId)).not.toContain("a");
  });

  it("skips a message the model could not judge instead of guessing", async () => {
    judge.mockImplementation(async (input: { messageId: string }) => (input.messageId === "a" ? null : { needsReply: true, kind: "business", reason: "r" }));
    const result = await loadWaitingReplies("u1", deps);
    if (result.state !== "ok") throw new Error("expected ok");
    expect(result.items.map((item) => item.messageId)).toEqual(["c", "b"]);
  });

  it("asks to connect Google, or reports unavailable, without inventing a list", async () => {
    search.mockRejectedValue(new ConnectionRequired());
    expect(await loadWaitingReplies("u1", deps)).toEqual({ state: "needs_connection" });
    search.mockRejectedValue(new Error("boom"));
    expect(await loadWaitingReplies("u1", deps)).toEqual({ state: "unavailable" });
  });

  it("carries each item's kind and the owner's choices, so the card can filter and say what it hides", async () => {
    prefs.mockResolvedValue({ saved: true, perchEnabled: true, remindersEnabled: true, kinds: ["person"] });
    const result = await loadWaitingReplies("u1", deps);
    if (result.state !== "ok") throw new Error("expected ok");
    expect(result.prefs).toMatchObject({ saved: true, kinds: ["person"] });
    expect(result.items.every((item) => item.kind === "person")).toBe(true);
  });

  it("reads no mail and spends nothing until the owner has answered the first-visit question", async () => {
    prefs.mockResolvedValue({ saved: false, perchEnabled: true, remindersEnabled: true, kinds: ["person", "business", "recruiter"] });
    expect(await loadWaitingReplies("u1", deps)).toMatchObject({ state: "setup" });
    expect(search).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("reads no mail when the owner turned reminders off", async () => {
    prefs.mockResolvedValue({ saved: true, perchEnabled: true, remindersEnabled: false, kinds: ["person"] });
    expect(await loadWaitingReplies("u1", deps)).toEqual({ state: "off" });
    expect(search).not.toHaveBeenCalled();
  });

  it("shows the sender's name without the address", () => {
    expect(displayName('"Sam Lee" <sam@x.com>')).toBe("Sam Lee");
    expect(displayName("<sam@x.com>")).toBe("sam@x.com");
  });
});
